import { describe, expect, it } from 'vitest';
import { departure, routeMinutes } from '../src/travel.ts';

describe('when to leave for an appointment', () => {
  const start = new Date('2026-11-20T14:00:00+01:00').getTime();

  it('counts the drive, a margin for traffic and time to park, rounded down to 5 minutes', () => {
    // 44.9 min → 45 drive, 7 margin (15 %), 10 to park: 62 min before 14:00 → 12:58 → 12:55
    expect(departure(start, 44.9)).toEqual({ leaveAt: new Date('2026-11-20T12:55:00+01:00').getTime(), driveMin: 45, marginMin: 7, parkingMin: 10 });
  });

  it('keeps at least 5 minutes of margin on a short drive', () => {
    expect(departure(start, 6)).toMatchObject({ driveMin: 6, marginMin: 5, leaveAt: new Date('2026-11-20T13:35:00+01:00').getTime() });
  });

  it('asks IGN for the fastest car route, in minutes', async () => {
    const urls: string[] = [];
    const min = await routeMinutes({ lat: 48.8566, lon: 2.3522 }, { lat: 48.8049, lon: 2.1301 }, async (url) => {
      urls.push(String(url));
      return Response.json({ distance: 29.5, duration: 44.86 });
    });
    expect(min).toEqual({ minutes: 44.86, km: 29.5 });
    const u = new URL(urls[0]);
    expect(u.origin + u.pathname).toBe('https://data.geopf.fr/navigation/itineraire');
    expect(u.searchParams.get('start')).toBe('2.3522,48.8566');
    expect(u.searchParams.get('end')).toBe('2.1301,48.8049');
    expect(u.searchParams.get('profile')).toBe('car');
  });
});
