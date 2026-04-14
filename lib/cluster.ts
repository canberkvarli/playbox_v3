import type { Station } from '@/data/stations.seed';

export type ClusterGroup = {
  id: string;
  lat: number;
  lng: number;
  count: number;
  stations: Station[];
};

export type ClusterOrStation =
  | { type: 'cluster'; data: ClusterGroup }
  | { type: 'station'; data: Station };

/**
 * Bin stations by a latitude/longitude grid. Stations in the same grid cell
 * collapse into a single cluster. Grid size derives from `latitudeDelta` — a
 * wider viewport means bigger cells, so more stations merge.
 *
 * Threshold: below 0.15 latitudeDelta, show individuals. Above, cluster.
 */
export function clusterStations(
  stations: Station[],
  latitudeDelta: number
): ClusterOrStation[] {
  if (latitudeDelta < 0.15) {
    return stations.map((s) => ({ type: 'station' as const, data: s }));
  }

  // Grid cell size roughly proportional to the viewport zoom
  const cellSize = latitudeDelta * 0.2; // cells ~= 20% of viewport in lat/lng
  const bins = new Map<string, Station[]>();
  for (const s of stations) {
    const row = Math.floor(s.lat / cellSize);
    const col = Math.floor(s.lng / cellSize);
    const key = `${row}_${col}`;
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key)!.push(s);
  }

  const out: ClusterOrStation[] = [];
  for (const [key, group] of bins) {
    if (group.length === 1) {
      out.push({ type: 'station', data: group[0] });
    } else {
      // Centroid of the cluster
      const lat = group.reduce((a, s) => a + s.lat, 0) / group.length;
      const lng = group.reduce((a, s) => a + s.lng, 0) / group.length;
      out.push({
        type: 'cluster',
        data: {
          id: `c_${key}`,
          lat,
          lng,
          count: group.length,
          stations: group,
        },
      });
    }
  }
  return out;
}
