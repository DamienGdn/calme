import { MAX_PARKING_MIN, PARKING_MIN } from '../../server/src/travel.ts';

/**
 * Time to park chosen for each appointment (0 to 20 min), remembered on this device: a per-viewer convenience, so
 * browser storage is enough. Kept for the last 200 appointments.
 */
const KEY = 'calme.parking';
export const PARKING_CHOICES = [0, 5, 10, 15, 20] as const;

function all(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

export function parkingFor(id: string): number {
  const v = all()[id];
  return Number.isInteger(v) && v >= 0 && v <= MAX_PARKING_MIN ? v : PARKING_MIN;
}

export function setParking(id: string, min: number) {
  try {
    const map = all();
    delete map[id];
    map[id] = min;
    const keys = Object.keys(map);
    for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete map[k];
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable: the choice holds for this sheet only */
  }
}
