import { ref } from 'vue';

/**
 * Where the user is. Once allowed (Admin › Position, or the first "When to leave?"), Calm follows the position while it
 * is open, so the departure time of an appointment shows at once. Kept in memory only, never stored nor sent anywhere
 * but to compute a route. A web app gets no position in the background: on the iPhone it updates when Calm is opened.
 */
export type PositionState = 'granted' | 'denied' | 'prompt' | 'unsupported';
export interface Here {
  lat: number;
  lon: number;
  at: number;
}

export const here = ref<Here | null>(null);
export const positionState = ref<PositionState>('prompt');
let watching: number | null = null;
const OPTIONS: PositionOptions = { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 };
/** A position older than this is asked again before computing a route. */
const FRESH_MS = 10 * 60_000;

const keep = (p: GeolocationPosition) => {
  here.value = { lat: p.coords.latitude, lon: p.coords.longitude, at: Date.now() };
  positionState.value = 'granted';
};

function follow() {
  if (watching !== null || !('geolocation' in navigator)) return;
  watching = navigator.geolocation.watchPosition(keep, (e) => {
    if (e.code === e.PERMISSION_DENIED) {
      positionState.value = 'denied';
      stopFollowing();
    }
  }, OPTIONS);
}
function stopFollowing() {
  if (watching !== null) navigator.geolocation.clearWatch(watching);
  watching = null;
}

/** At start: reads the permission, and follows the position when it is already allowed. */
export async function initPosition() {
  if (!('geolocation' in navigator)) {
    positionState.value = 'unsupported';
    return;
  }
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    if (status) {
      positionState.value = status.state as PositionState;
      status.onchange = () => {
        positionState.value = status.state as PositionState;
        if (status.state === 'granted') follow();
        else stopFollowing();
      };
    }
  } catch {
    /* no Permissions API: the state shows once asked */
  }
  if (positionState.value === 'granted') follow();
}

/** Asks for the position (the system shows its permission prompt the first time), then follows it. */
export function currentPosition(): Promise<Here> {
  if (here.value && Date.now() - here.value.at < FRESH_MS) return Promise.resolve(here.value);
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      positionState.value = 'unsupported';
      return reject(new Error('no geolocation'));
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        keep(p);
        follow();
        resolve(here.value!);
      },
      (e) => {
        if (e.code === e.PERMISSION_DENIED) positionState.value = 'denied';
        reject(e);
      },
      OPTIONS,
    );
  });
}
