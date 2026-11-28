/**
 * CEP validation, normalization, and street lookup restricted to Florianopolis Island
 * (range 88010-000 through 88059-999).
 */

export const ISLAND_CEP_MIN = 88010000;
export const ISLAND_CEP_MAX = 88069999;

export const DEFAULT_DEPOT = {
  name: "CEE Correios - Av. Diomicio de Freitas, 1899",
  cep: "88047401",
  lat: -27.664631239987585,
  lng: -48.53156334735702,
} as const;

export interface CepLookupResult {
  cep: string;
  logradouro: string;
  bairro: string | null;
  localidade: string;
  uf: string;
  source: "viacep" | "brasilapi";
}

/** Strips non-digit characters from a CEP string. */
export function normalizeCep(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Formats an 8-digit CEP as XXXXX-XXX. */
export function formatCep(cep: string): string {
  const digits = normalizeCep(cep);
  if (digits.length !== 8) return cep;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

/** Returns true strictly when the CEP is 8 digits inside 88010-000..88059-999. */
export function isValidIslandCep(raw: string): boolean {
  const digits = normalizeCep(raw);
  if (digits.length !== 8) return false;
  const numeric = Number.parseInt(digits, 10);
  return numeric >= ISLAND_CEP_MIN && numeric <= ISLAND_CEP_MAX;
}

/** Throws an Error if the CEP falls outside Florianopolis Island's valid range. */
export function assertValidIslandCep(raw: string): string {
  const digits = normalizeCep(raw);
  if (!isValidIslandCep(digits)) {
    throw new Error(
      `CEP ${raw} fora do range permitido da Ilha de Florianopolis (88010-000 ate 88059-999).`
    );
  }
  return digits;
}

/**
 * Normalizes a street number for deduplication and cache keying.
 * Converts S/N, '-', empty, or null values to 'SN' while keeping alphanumeric numbers like '285B'.
 */
export function normalizeStreetNumber(raw: string | null | undefined): {
  numeroRaw: string | null;
  numeroNorm: string;
} {
  if (!raw) {
    return { numeroRaw: null, numeroNorm: "SN" };
  }
  const cleaned = raw.trim().replace(/^n[º°o.]?\s*/i, "");
  if (
    !cleaned ||
    cleaned === "-" ||
    /^s\/?n\.?$/i.test(cleaned) ||
    /^sem\s+n[uú]mero$/i.test(cleaned)
  ) {
    return { numeroRaw: null, numeroNorm: "SN" };
  }
  const normalized = cleaned.toUpperCase().replace(/\s+/g, "");
  return { numeroRaw: cleaned, numeroNorm: normalized };
}

/**
 * Queries ViaCEP first and falls back to BrasilAPI if ViaCEP is unavailable or times out.
 * Enforces the Florianopolis Island CEP range before making any network call.
 */
export async function fetchCepWithFallback(
  rawCep: string,
  timeoutMs = 5000
): Promise<CepLookupResult> {
  const cep = assertValidIslandCep(rawCep);

  // 1. Primary lookup: ViaCEP
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = (await res.json()) as {
        erro?: boolean;
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
      };
      if (!data.erro && data.logradouro) {
        return {
          cep,
          logradouro: data.logradouro.trim(),
          bairro: data.bairro?.trim() || null,
          localidade: data.localidade?.trim() || "Florianopolis",
          uf: data.uf?.trim() || "SC",
          source: "viacep",
        };
      }
    }
  } catch {
    // Fall through to BrasilAPI on network error or timeout.
  }

  // 2. Fallback lookup: BrasilAPI
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fallbackRes = await fetch(
    `https://brasilapi.com.br/api/cep/v2/${cep}`,
    {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    }
  );
  clearTimeout(timer);

  if (!fallbackRes.ok) {
    throw new Error(
      `Nao foi possivel consultar o CEP ${formatCep(cep)} no ViaCEP nem na BrasilAPI.`
    );
  }

  const fbData = (await fallbackRes.json()) as {
    street?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
  };

  if (!fbData.street) {
    throw new Error(
      `CEP ${formatCep(cep)} encontrado sem logradouro definido.`
    );
  }

  return {
    cep,
    logradouro: fbData.street.trim(),
    bairro: fbData.neighborhood?.trim() || null,
    localidade: fbData.city?.trim() || "Florianopolis",
    uf: fbData.state?.trim() || "SC",
    source: "brasilapi",
  };
}
