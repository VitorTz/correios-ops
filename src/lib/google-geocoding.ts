import { and, eq, gt, isNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import { addressCache } from "@/db/schema";
import { formatCep } from "./cep";

/** Bounding box strictly enclosing Florianopolis Island (SC, Brazil). */
export const ISLAND_BOUNDS = {
  south: -27.86,
  west: -48.62,
  north: -27.38,
  east: -48.35,
} as const;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface GeocodeResult {
  lat: number;
  lng: number;
  placeId: string | null;
  locationType: string | null;
  fromCache: boolean;
}

interface GoogleGeocodeApiResponse {
  status: string;
  error_message?: string;
  results: Array<{
    place_id?: string;
    geometry: {
      location: { lat: number; lng: number };
      location_type?: string;
    };
  }>;
}

export function isInsideIslandBounds(lat: number, lng: number): boolean {
  return (
    lat >= ISLAND_BOUNDS.south &&
    lat <= ISLAND_BOUNDS.north &&
    lng >= ISLAND_BOUNDS.west &&
    lng <= ISLAND_BOUNDS.east
  );
}

/**
 * Calls Google Geocoding API using `components=country:BR` and Island `bounds` bias.
 * Avoids `components=postal_code:...` because Google's postal_code filter in Brazil
 * often rejects valid Correios/ViaCEP street-level CEPs with ZERO_RESULTS.
 */
async function queryGoogleGeocode(
  address: string,
  apiKey: string
): Promise<{
  lat: number;
  lng: number;
  placeId: string | null;
  locationType: string | null;
} | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("components", "country:BR");
  url.searchParams.set(
    "bounds",
    `${ISLAND_BOUNDS.south},${ISLAND_BOUNDS.west}|${ISLAND_BOUNDS.north},${ISLAND_BOUNDS.east}`
  );
  url.searchParams.set("region", "br");
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("key", apiKey);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Google Geocoding HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GoogleGeocodeApiResponse;

  if (payload.status === "ZERO_RESULTS") {
    return null;
  }

  if (payload.status !== "OK" || payload.results.length === 0) {
    throw new Error(
      `Google Geocoding erro (${payload.status}): ${payload.error_message ?? "sem detalhes"}`
    );
  }

  // Pick the first result strictly inside Florianopolis Island bounds
  const match = payload.results.find((r) =>
    isInsideIslandBounds(r.geometry.location.lat, r.geometry.location.lng)
  );
  if (!match) {
    return null;
  }

  return {
    lat: match.geometry.location.lat,
    lng: match.geometry.location.lng,
    placeId: match.place_id ?? null,
    locationType: match.geometry.location_type ?? null,
  };
}

/**
 * Resolves (cep, numeroNorm, logradouro) to coordinates using NeonDB address_cache first
 * (honoring manual overrides with expires_at = NULL and Google's 30-day cache window),
 * then tries progressive query fallbacks without the strict postal_code component filter.
 */
export async function geocodeAddressWithCache(params: {
  cep: string;
  numeroNorm: string;
  logradouro: string;
  bairro?: string | null;
}): Promise<GeocodeResult> {
  const db = getDb();
  const now = new Date();

  const [cached] = await db
    .select()
    .from(addressCache)
    .where(
      and(
        eq(addressCache.cep, params.cep),
        eq(addressCache.numeroNorm, params.numeroNorm),
        or(isNull(addressCache.expiresAt), gt(addressCache.expiresAt, now))
      )
    );

  if (cached) {
    return {
      lat: cached.lat,
      lng: cached.lng,
      placeId: cached.placeId,
      locationType: cached.locationType,
      fromCache: true,
    };
  }

  const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_MAPS_SERVER_API_KEY is not configured.");
  }

  const formattedCep = formatCep(params.cep);
  const numberPart = params.numeroNorm === "SN" ? "" : `, ${params.numeroNorm}`;
  const bairroPart = params.bairro ? `, ${params.bairro}` : "";

  // Progressive fallback chain: full address -> without CEP -> street only -> CEP only
  const candidateQueries = Array.from(
    new Set([
      `${params.logradouro}${numberPart}${bairroPart}, Florianópolis - SC, ${formattedCep}, Brasil`,
      `${params.logradouro}${numberPart}, Florianópolis - SC, Brasil`,
      `${params.logradouro}, Florianópolis - SC, Brasil`,
      `${formattedCep}, Florianópolis - SC, Brasil`,
    ])
  );

  let best: {
    lat: number;
    lng: number;
    placeId: string | null;
    locationType: string | null;
  } | null = null;

  for (const query of candidateQueries) {
    best = await queryGoogleGeocode(query, apiKey);
    if (best) break;
  }

  if (!best) {
    throw new Error(
      `Geocoding nao encontrou coordenadas dentro da Ilha de Florianopolis para "${params.logradouro}${numberPart}" (${formattedCep}).`
    );
  }

  const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS);

  await db
    .insert(addressCache)
    .values({
      cep: params.cep,
      numeroNorm: params.numeroNorm,
      logradouro: params.logradouro,
      lat: best.lat,
      lng: best.lng,
      placeId: best.placeId,
      locationType: best.locationType,
      isManualOverride: false,
      cachedAt: now,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [addressCache.cep, addressCache.numeroNorm],
      set: {
        logradouro: params.logradouro,
        lat: best.lat,
        lng: best.lng,
        placeId: best.placeId,
        locationType: best.locationType,
        isManualOverride: false,
        cachedAt: now,
        expiresAt,
      },
    });

  return {
    lat: best.lat,
    lng: best.lng,
    placeId: best.placeId,
    locationType: best.locationType,
    fromCache: false,
  };
}
