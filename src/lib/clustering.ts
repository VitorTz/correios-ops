/**
 * Two-person Anchor + Adjacent walking cluster engine.
 * 1. Spatial pre-filter (Haversine <= 1.4 * walkRadiusMeters) eliminates distant pairs at zero API cost.
 * 2. Connected components are validated via Google Routes computeRouteMatrix (WALK, <= 625 elements/call).
 * 3. Weighted Greedy Set Cover chooses the minimum set of Anchor stops covering unlimited Adjacent stops.
 */

export interface AddressNode {
  key: string; // e.g. "88056300::946" or "manual::<pkgId>"
  lat: number;
  lng: number;
  label: string;
  packageCount: number;
  packageIds: string[];
}

export interface ClusterAdjacent {
  node: AddressNode;
  walkDistanceMeters: number;
}

export interface AnchorCluster {
  anchor: AddressNode;
  adjacents: ClusterAdjacent[];
}

const EARTH_RADIUS_M = 6371000;
const MAX_MATRIX_ELEMENTS = 625;

/** Straight-line Haversine distance in meters. */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Splits nodes into spatially connected components using straight-line pre-filter. */
export function buildSpatialComponents(
  nodes: AddressNode[],
  walkRadiusMeters: number
): AddressNode[][] {
  const prefilterRadius = Math.max(walkRadiusMeters * 1.4, walkRadiusMeters + 30);
  const visited = new Set<number>();
  const components: AddressNode[][] = [];

  for (let i = 0; i < nodes.length; i += 1) {
    if (visited.has(i)) continue;
    const queue = [i];
    visited.add(i);
    const comp: AddressNode[] = [];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      comp.push(nodes[curr]);
      for (let j = 0; j < nodes.length; j += 1) {
        if (visited.has(j)) continue;
        const d = haversineMeters(
          nodes[curr].lat,
          nodes[curr].lng,
          nodes[j].lat,
          nodes[j].lng
        );
        if (d <= prefilterRadius) {
          visited.add(j);
          queue.push(j);
        }
      }
    }
    components.push(comp);
  }
  return components;
}

/**
 * Queries Google Routes API computeRouteMatrix (WALK mode) for a spatial component,
 * chunking automatically to stay strictly under Google's 625-element cap per request.
 */
export async function fetchWalkDistanceMatrix(
  component: AddressNode[],
  apiKey: string
): Promise<Map<string, number>> {
  const distances = new Map<string, number>();
  const n = component.length;
  if (n <= 1) return distances;

  const chunkSize = Math.floor(Math.sqrt(MAX_MATRIX_ELEMENTS));

  for (let oStart = 0; oStart < n; oStart += chunkSize) {
    const originsSlice = component.slice(oStart, oStart + chunkSize);
    for (let dStart = 0; dStart < n; dStart += chunkSize) {
      const destsSlice = component.slice(dStart, dStart + chunkSize);

      const body = {
        origins: originsSlice.map((node) => ({
          waypoint: {
            location: { latLng: { latitude: node.lat, longitude: node.lng } },
          },
        })),
        destinations: destsSlice.map((node) => ({
          waypoint: {
            location: { latLng: { latitude: node.lat, longitude: node.lng } },
          },
        })),
        travelMode: "WALK",
      };

      const response = await fetch(
        "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask":
              "originIndex,destinationIndex,distanceMeters,condition",
          },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Google computeRouteMatrix WALK HTTP ${response.status}: ${text}`
        );
      }

      const elements = (await response.json()) as Array<{
        originIndex?: number;
        destinationIndex?: number;
        distanceMeters?: number;
        condition?: string;
      }>;

      for (const el of elements) {
        if (
          el.originIndex === undefined ||
          el.destinationIndex === undefined ||
          el.condition !== "ROUTE_EXISTS"
        ) {
          continue;
        }
        // Protobuf JSON omits default 0 when origin and destination coincide
        const meters = el.distanceMeters ?? 0;
        const fromKey = originsSlice[el.originIndex].key;
        const toKey = destsSlice[el.destinationIndex].key;
        distances.set(`${fromKey}->${toKey}`, meters);
      }
    }
  }

  return distances;
}

/**
 * Pure Greedy Set Cover over a verified pedestrian distance matrix.
 * Guarantees unlimited adjacent points per anchor while minimizing total car stops.
 */
export function solveAnchorClustersFromMatrix(
  component: AddressNode[],
  walkDistances: Map<string, number>,
  walkRadiusMeters: number
): AnchorCluster[] {
  if (component.length === 0) return [];
  if (component.length === 1) {
    return [{ anchor: component[0], adjacents: [] }];
  }

  const uncovered = new Set<string>(component.map((n) => n.key));
  const nodeByKey = new Map<string, AddressNode>(
    component.map((n) => [n.key, n])
  );
  const clusters: AnchorCluster[] = [];

  while (uncovered.size > 0) {
    let bestAnchor: AddressNode | null = null;
    let bestCovered: Array<{ key: string; dist: number }> = [];
    let bestScore = -1;

    for (const candidateKey of uncovered) {
      const candidate = nodeByKey.get(candidateKey)!;
      const reachable: Array<{ key: string; dist: number }> = [];

      for (const targetKey of uncovered) {
        if (targetKey === candidateKey) continue;
        const d = walkDistances.get(`${candidateKey}->${targetKey}`);
        if (d !== undefined && d <= walkRadiusMeters) {
          reachable.push({ key: targetKey, dist: d });
        }
      }

      const score = (reachable.length + 1) * 10000 + candidate.packageCount;
      if (score > bestScore) {
        bestScore = score;
        bestAnchor = candidate;
        bestCovered = reachable;
      }
    }

    if (!bestAnchor) break;

    uncovered.delete(bestAnchor.key);
    const adjacents: ClusterAdjacent[] = [];
    for (const item of bestCovered) {
      uncovered.delete(item.key);
      adjacents.push({
        node: nodeByKey.get(item.key)!,
        walkDistanceMeters: item.dist,
      });
    }

    adjacents.sort((a, b) => a.walkDistanceMeters - b.walkDistanceMeters);
    clusters.push({ anchor: bestAnchor, adjacents });
  }

  return clusters;
}

/** End-to-end Anchor + Adjacent clustering for all unique active addresses of a route. */
export async function clusterRouteAddresses(
  nodes: AddressNode[],
  walkRadiusMeters: number,
  googleApiKey: string
): Promise<AnchorCluster[]> {
  const components = buildSpatialComponents(nodes, walkRadiusMeters);
  const allClusters: AnchorCluster[] = [];

  for (const comp of components) {
    if (comp.length === 1) {
      allClusters.push({ anchor: comp[0], adjacents: [] });
      continue;
    }
    const matrix = await fetchWalkDistanceMatrix(comp, googleApiKey);
    const compClusters = solveAnchorClustersFromMatrix(
      comp,
      matrix,
      walkRadiusMeters
    );
    allClusters.push(...compClusters);
  }

  return allClusters;
}
