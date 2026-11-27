import { GoogleAuth } from "google-auth-library";

export interface AnchorInput {
  anchorId: string;
  label: string;
  lat: number;
  lng: number;
  packageCount: number;
}

export interface OptimizeRouteInput {
  depotLat: number;
  depotLng: number;
  anchors: AnchorInput[];
  kmPerLiter: number;
  fuelPriceBrl: number;
}

export interface OptimizedRouteOutput {
  orderedAnchorIds: string[];
  totalDistanceKm: number;
  totalDurationSec: number;
  encodedPolyline: string | null;
  engineUsed: "google_route_optimization_v1" | "google_compute_routes_v2";
}

export function buildOptimizeToursPayload(input: OptimizeRouteInput) {
  const costPerKilometer =
    input.kmPerLiter > 0
      ? Number((input.fuelPriceBrl / input.kmPerLiter).toFixed(4))
      : 0.6;

  const costPerTraveledHour = 25.0;

  return {
    populatePolylines: true,
    populateTransitionPolylines: false,
    model: {
      shipments: input.anchors.map((anchor) => ({
        label: anchor.anchorId,
        deliveries: [
          {
            arrivalLocation: {
              latitude: anchor.lat,
              longitude: anchor.lng,
            },
            duration: `${Math.max(60, anchor.packageCount * 45)}s`,
          },
        ],
      })),
      vehicles: [
        {
          label: "correios-duo-car",
          travelMode: "DRIVING",
          startLocation: {
            latitude: input.depotLat,
            longitude: input.depotLng,
          },
          endLocation: {
            latitude: input.depotLat,
            longitude: input.depotLng,
          },
          costPerKilometer,
          costPerTraveledHour,
        },
      ],
    },
  };
}

function parseProtobufDurationSec(raw?: string): number {
  if (!raw) return 0;
  const match = raw.match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Math.round(Number.parseFloat(match[1])) : 0;
}

export async function optimizeAnchorRoute(
  input: OptimizeRouteInput
): Promise<OptimizedRouteOutput> {
  if (input.anchors.length === 0) {
    return {
      orderedAnchorIds: [],
      totalDistanceKm: 0,
      totalDurationSec: 0,
      encodedPolyline: null,
      engineUsed: "google_route_optimization_v1",
    };
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const serviceAccountJson = process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON;

  if (projectId && serviceAccountJson) {
    const credentials = JSON.parse(serviceAccountJson) as Record<string, unknown>;
    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const accessToken = tokenResponse.token;

    if (!accessToken) {
      throw new Error("Failed to obtain OAuth2 access token for Route Optimization API.");
    }

    const endpoint = `https://routeoptimization.googleapis.com/v1/projects/${projectId}:optimizeTours`;
    const payload = buildOptimizeToursPayload(input);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google optimizeTours HTTP ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as {
      routes?: Array<{
        visits?: Array<{ shipmentIndex?: number; shipmentLabel?: string }>;
        routePolyline?: { points?: string };
        metrics?: {
          travelDistanceMeters?: number | string;
          totalDuration?: string;
        };
      }>;
    };

    const route = data.routes?.[0];
    if (!route) {
      throw new Error("Google optimizeTours retornou resposta sem rota valida.");
    }

    const orderedAnchorIds = (route.visits ?? []).map((visit) => {
      if (visit.shipmentLabel) return visit.shipmentLabel;
      const idx = visit.shipmentIndex ?? 0;
      return input.anchors[idx].anchorId;
    });

    // Preserve any unvisited anchor at the end so no stop is ever dropped silently
    const visitedSet = new Set(orderedAnchorIds);
    for (const anchor of input.anchors) {
      if (!visitedSet.has(anchor.anchorId)) {
        orderedAnchorIds.push(anchor.anchorId);
      }
    }

    // Protobuf int64 may arrive as string in REST JSON
    const meters = Number(route.metrics?.travelDistanceMeters ?? 0);
    return {
      orderedAnchorIds,
      totalDistanceKm: Number((meters / 1000).toFixed(2)),
      totalDurationSec: parseProtobufDurationSec(route.metrics?.totalDuration),
      encodedPolyline: route.routePolyline?.points ?? null,
      engineUsed: "google_route_optimization_v1",
    };
  }

  const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Configure GOOGLE_CLOUD_PROJECT_ID + GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON (Caminho A) ou GOOGLE_MAPS_SERVER_API_KEY."
    );
  }
  if (input.anchors.length > 25) {
    throw new Error(
      `Rota com ${input.anchors.length} ancoras exige GOOGLE_CLOUD_PROJECT_ID e GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON para chamar optimizeTours.`
    );
  }

  const res = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.optimizedIntermediateWaypointIndex",
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: { latitude: input.depotLat, longitude: input.depotLng },
          },
        },
        destination: {
          location: {
            latLng: { latitude: input.depotLat, longitude: input.depotLng },
          },
        },
        intermediates: input.anchors.map((a) => ({
          location: { latLng: { latitude: a.lat, longitude: a.lng } },
        })),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE_OPTIMAL",
        optimizeWaypointOrder: true,
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google computeRoutes HTTP ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as {
    routes?: Array<{
      distanceMeters?: number | string;
      duration?: string;
      polyline?: { encodedPolyline?: string };
      optimizedIntermediateWaypointIndex?: number[];
    }>;
  };

  const first = data.routes?.[0];
  if (!first) {
    throw new Error("Google computeRoutes nao retornou rota valida.");
  }

  const indices =
    first.optimizedIntermediateWaypointIndex ??
    input.anchors.map((_, idx) => idx);

  const meters = Number(first.distanceMeters ?? 0);
  return {
    orderedAnchorIds: indices.map((idx) => input.anchors[idx].anchorId),
    totalDistanceKm: Number((meters / 1000).toFixed(2)),
    totalDurationSec: parseProtobufDurationSec(first.duration),
    encodedPolyline: first.polyline?.encodedPolyline ?? null,
    engineUsed: "google_compute_routes_v2",
  };
}
