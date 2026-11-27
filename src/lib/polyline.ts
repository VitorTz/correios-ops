/**
 * Pure TypeScript Google Encoded Polyline decoder and segment bearing helper
 * so OpenStreetMap (Leaflet) renders routes without loading Google Maps JS.
 */

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export function decodePolyline(encoded: string): LatLngPoint[] {
  const points: LatLngPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    const dLat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dLat;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    const dLng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dLng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

/**
 * Returns screen-space clockwise rotation angle (degrees, 0 = pointing right/east)
 * for directional arrow icons along a polyline segment.
 */
export function computeScreenArrowAngle(
  from: LatLngPoint,
  to: LatLngPoint
): number {
  const dLng = to.lng - from.lng;
  const dLat = to.lat - from.lat;
  // Screen Y increases downward while latitude increases northward
  return (Math.atan2(-dLat, dLng) * 180) / Math.PI;
}
