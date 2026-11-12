/**
 * When to leave for an appointment: the car route from where the user is (IGN Géoplateforme, free and keyless,
 * fastest route, no live traffic), plus a margin for traffic and a few minutes to find a parking spot.
 */
export interface Point {
  lat: number;
  lon: number;
}
export interface Departure {
  leaveAt: number;
  driveMin: number;
  marginMin: number;
  parkingMin: number;
}

/** Minutes to find a spot and walk from the car, by default; each appointment can set 0 to 20. */
export const PARKING_MIN = 10;
export const MAX_PARKING_MIN = 20;

export function departure(start: number, routeMin: number, parkingMin = PARKING_MIN): Departure {
  const driveMin = Math.ceil(routeMin - 0.01); // 44.9 → 45, 6 → 6
  const marginMin = Math.max(5, Math.round(driveMin * 0.15));
  const raw = start - (driveMin + marginMin + parkingMin) * 60_000;
  const step = 5 * 60_000;
  return { leaveAt: Math.floor(raw / step) * step, driveMin, marginMin, parkingMin };
}

export const validPoint = (p: unknown): p is Point =>
  typeof p === 'object' && p !== null &&
  Number.isFinite((p as Point).lat) && Math.abs((p as Point).lat) <= 90 &&
  Number.isFinite((p as Point).lon) && Math.abs((p as Point).lon) <= 180;

export async function routeMinutes(from: Point, to: Point, fetchImpl: typeof fetch = fetch): Promise<{ minutes: number; km: number }> {
  const params = new URLSearchParams({
    resource: 'bdtopo-osrm',
    profile: 'car',
    optimization: 'fastest',
    start: `${from.lon},${from.lat}`,
    end: `${to.lon},${to.lat}`,
    getSteps: 'false',
    timeUnit: 'minute',
    distanceUnit: 'kilometer',
  });
  const res = await fetchImpl(`https://data.geopf.fr/navigation/itineraire?${params}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as { duration?: number; distance?: number };
  if (!Number.isFinite(j.duration)) throw new Error('No route');
  return { minutes: Number(j.duration), km: Number(j.distance ?? 0) };
}
