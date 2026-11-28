/**
 * Generates sequential Google Maps Directions URLs respecting the official
 * 9-intermediate-waypoint limit (origin + up to 9 waypoints + destination = 10 stops per leg).
 */

export interface AnchorCoord {
  sequenceOrder: number;
  lat: number;
  lng: number;
  label: string | null;
}

export interface GoogleMapsLegLink {
  legNumber: number;
  title: string;
  stopsRange: string;
  url: string;
  stopCount: number;
}

const MAX_INTERMEDIATE_WAYPOINTS = 9;

function coordStr(lat: number, lng: number): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

function buildDirectionsUrl(
  origin: string,
  destination: string,
  waypoints: string[]
): string {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  if (waypoints.length > 0) {
    url.searchParams.set("waypoints", waypoints.join("|"));
  }
  url.searchParams.set("travelmode", "driving");
  return url.toString();
}

/**
 * Splits an ordered list of anchors (starting and ending at the CEE depot)
 * into consecutive Google Maps navigation links with at most 9 waypoints each.
 */
export function buildGoogleMapsLegLinks(params: {
  depotLat: number;
  depotLng: number;
  anchors: AnchorCoord[];
}): GoogleMapsLegLink[] {
  const { depotLat, depotLng, anchors } = params;
  if (anchors.length === 0) return [];

  const ordered = [...anchors].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  const depot = coordStr(depotLat, depotLng);

  // Single link covers entire route when there are <= 9 anchors (CEE -> #1..#N -> CEE)
  if (ordered.length <= MAX_INTERMEDIATE_WAYPOINTS) {
    return [
      {
        legNumber: 1,
        title: "Rota Completa",
        stopsRange: `CEE -> #1 ate #${ordered.length} -> CEE`,
        url: buildDirectionsUrl(
          depot,
          depot,
          ordered.map((a) => coordStr(a.lat, a.lng))
        ),
        stopCount: ordered.length,
      },
    ];
  }

  const legs: GoogleMapsLegLink[] = [];
  let cursor = 0;
  let currentOrigin = depot;
  let currentOriginLabel = "CEE";

  while (cursor < ordered.length) {
    const remaining = ordered.length - cursor;

    // If remaining anchors fit inside the 9-waypoint cap, finish directly back at CEE
    if (remaining <= MAX_INTERMEDIATE_WAYPOINTS) {
      const slice = ordered.slice(cursor);
      const firstSeq = slice[0].sequenceOrder;
      const lastSeq = slice[slice.length - 1].sequenceOrder;
      legs.push({
        legNumber: legs.length + 1,
        title: `Trecho ${legs.length + 1} (Retorno)`,
        stopsRange: `${currentOriginLabel} -> #${firstSeq}..#${lastSeq} -> CEE`,
        url: buildDirectionsUrl(
          currentOrigin,
          depot,
          slice.map((a) => coordStr(a.lat, a.lng))
        ),
        stopCount: slice.length,
      });
      break;
    }

    // Take 10 anchors: first 9 as intermediate waypoints, 10th as leg destination
    const chunk = ordered.slice(cursor, cursor + MAX_INTERMEDIATE_WAYPOINTS + 1);
    const waypoints = chunk.slice(0, -1).map((a) => coordStr(a.lat, a.lng));
    const destAnchor = chunk[chunk.length - 1];
    const firstSeq = chunk[0].sequenceOrder;
    const destSeq = destAnchor.sequenceOrder;

    legs.push({
      legNumber: legs.length + 1,
      title: `Trecho ${legs.length + 1}`,
      stopsRange: `${currentOriginLabel} -> #${firstSeq} ate #${destSeq}`,
      url: buildDirectionsUrl(
        currentOrigin,
        coordStr(destAnchor.lat, destAnchor.lng),
        waypoints
      ),
      stopCount: chunk.length,
    });

    currentOrigin = coordStr(destAnchor.lat, destAnchor.lng);
    currentOriginLabel = `#${destSeq}`;
    cursor += chunk.length;
  }

  return legs;
}
