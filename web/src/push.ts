import { api, post } from './api.ts';
import { i18n } from './i18n.ts';

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
}

export async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
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
