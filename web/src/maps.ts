/**
 * "See on the map" opens Apple Plans: maps.apple.com hands over to the Plans app on iPhone, iPad and Mac (the desktop
 * app opens it directly, see desktop/main.cjs), and shows the map in a browser elsewhere.
 */
export function mapsUrl(place: string, coords?: { lat: number; lon: number } | null): string {
  const q = place.trim();
  if (!q) return '';
  const params = new URLSearchParams({ q });
  if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)) params.set('ll', `${coords.lat},${coords.lon}`);
  return `https://maps.apple.com/?${params}`;
}

/** The car route to a place, from where you are, in Apple Plans. */
export function directionsUrl(place: string): string {
  return `https://maps.apple.com/?${new URLSearchParams({ daddr: place.trim(), dirflg: 'd' })}`;
}
