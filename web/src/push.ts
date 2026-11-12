import { api, post } from './api.ts';
import { i18n } from './i18n.ts';

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
}

export async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    // Each opening checks for a newer worker (e.g. the one that sets the icon badge), without waiting a day.
    void reg.update().catch(() => {});
    return reg;
  } catch {
    return null;
  }
}

export async function isSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return Boolean(await reg?.pushManager.getSubscription());
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Why the unread count may not show on the app icon: the Badging API, notification permission, home-screen mode. */
export function badgeStatus() {
  return {
    supported: 'setAppBadge' in navigator,
    permission: 'Notification' in window ? Notification.permission : 'unsupported',
    homeScreen: matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
  };
}

/** Puts a number on the app icon now, to check it shows (the next refresh puts the real count back). */
export async function testBadge(n: number): Promise<void> {
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void> };
  if (!nav.setAppBadge) throw new Error(i18n.global.t('badge.unsupported'));
  await nav.setAppBadge(n);
}

/** Asks permission (must run from a user gesture: iOS requires it) and registers this device for push. */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error(i18n.global.t('push.unsupported'));
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(i18n.global.t('push.denied'));
  const reg = (await registerWorker()) ?? (await navigator.serviceWorker.ready);
  const { publicKey } = await api<{ publicKey: string }>('/api/push/key');
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await post('/api/push/subscribe', sub.toJSON());
}
