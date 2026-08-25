import type { GeoJsonLineString } from '../../domain/route-planner/route-planner.types';

export function decodePolyline6(encoded: string): GeoJsonLineString {
  const coordinates: [number, number][] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  const decodeValue = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) throw new Error('Polyline6 incompleta.');
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    latitude += decodeValue();
    longitude += decodeValue();
    coordinates.push([longitude / 1e6, latitude / 1e6]);
  }
  return { type: 'LineString', coordinates };
}
