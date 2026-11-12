/**
 * Place suggestions for an appointment, as the user types: street addresses from the French national address base
 * (IGN Géoplateforme) and named places — shops, chains, pharmacies, restaurants… — from OpenStreetMap through Photon.
 * Both are free and keyless; only the typed text is sent. When one is down, the other's suggestions are kept.
 */
export interface Place {
  kind: 'address' | 'place';
  label: string;
  name: string;
  postcode: string;
  city: string;
  context: string;
  lat: number;
  lon: number;
}

type Feature = { geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> };
type Fetch = typeof fetch;

const MAX = 6;
/** OpenStreetMap keys of named places one goes to (streets, towns and boundaries are the address base's job). */
const POI_KEYS = new Set(['shop', 'amenity', 'tourism', 'leisure', 'office', 'craft', 'healthcare', 'club', 'sport']);
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

async function features(fetchImpl: Fetch, url: string): Promise<Feature[]> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { features?: Feature[] }).features ?? [];
}

async function addresses(fetchImpl: Fetch, q: string): Promise<Place[]> {
  const url = `https://data.geopf.fr/geocodage/search?${new URLSearchParams({ q, limit: String(MAX), autocomplete: '1', index: 'address' })}`;
  return (await features(fetchImpl, url)).map((f) => ({
    kind: 'address',
    label: str(f.properties?.label),
    name: str(f.properties?.name),
    postcode: str(f.properties?.postcode),
    city: str(f.properties?.city),
    context: str(f.properties?.context),
    lat: Number(f.geometry?.coordinates?.[1]),
    lon: Number(f.geometry?.coordinates?.[0]),
  }));
}

async function places(fetchImpl: Fetch, q: string): Promise<Place[]> {
  const url = `https://photon.komoot.io/api/?${new URLSearchParams({ q, limit: '10', lang: 'fr' })}`;
  return (await features(fetchImpl, url)).flatMap((f): Place[] => {
    const p = f.properties ?? {};
    const name = str(p.name);
    if (!name || !POI_KEYS.has(str(p.osm_key)) || str(p.countrycode) !== 'FR') return [];
    const street = [str(p.housenumber), str(p.street)].filter(Boolean).join(' ');
    const town = [str(p.postcode), str(p.city)].filter(Boolean).join(' ');
    return [
      {
        kind: 'place',
        label: [name, street, town].filter(Boolean).join(', '),
        name,
        postcode: str(p.postcode),
        city: str(p.city),
        context: [str(p.city), str(p.county)].filter(Boolean).join(', '),
        lat: Number(f.geometry?.coordinates?.[1]),
        lon: Number(f.geometry?.coordinates?.[0]),
      },
    ];
  });
}

/**
 * Up to six suggestions: named places first, unless the text starts with a number (then it is a street address).
 * Throws only when both services fail, so the user knows to type the address by hand.
 */
export async function searchPlaces(q: string, fetchImpl: Fetch = fetch): Promise<Place[]> {
  const [a, p] = await Promise.allSettled([addresses(fetchImpl, q), places(fetchImpl, q)]);
  if (a.status === 'rejected' && p.status === 'rejected') throw new Error('Place search unavailable');
  const found = { address: a.status === 'fulfilled' ? a.value : [], place: p.status === 'fulfilled' ? p.value : [] };
  const [first, then] = /^\d/.test(q) ? [found.address, found.place] : [found.place, found.address];
  // Keep room for the other kind: at most four of the first, the rest from the other.
  const head = first.slice(0, then.length ? 4 : MAX);
  return [...head, ...then].slice(0, MAX);
}
