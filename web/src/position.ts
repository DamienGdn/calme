/** Where the user is now, asked of the device only when they want to know when to leave (never stored). */
export function currentPosition(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('no geolocation'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      reject,
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 5 * 60_000 },
    );
  });
}

/** True when the user already let Calm use the position, so the departure time can show without a tap. */
export async function positionAllowed(): Promise<boolean> {
  try {
    return (await navigator.permissions?.query({ name: 'geolocation' as PermissionName }))?.state === 'granted';
  } catch {
    return false;
  }
}
