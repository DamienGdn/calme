import { computed, ref } from 'vue';

/**
 * "Install the app": Chrome, Edge and Android hand the page an install prompt it can open from a button. Safari
 * (iPhone, iPad, Mac) never does — no page may install itself there — so the button shows the gestures instead.
 */
export type InstallMode = 'prompt' | 'ios' | 'mac-safari' | null;

interface Env {
  ua: string;
  /** navigator.maxTouchPoints: iPadOS reads as a Mac, its touch screen gives it away. */
  touchPoints: number;
  /** Already opened from its icon. */
  standalone: boolean;
  /** Inside the Electron app (it is the installed app on the computer). */
  desktopApp: boolean;
  /** The browser handed over its install prompt (beforeinstallprompt). */
  canPrompt: boolean;
}

export function installMode(e: Env): InstallMode {
  if (e.standalone || e.desktopApp) return null;
  if (e.canPrompt) return 'prompt';
  const mac = /Macintosh/.test(e.ua);
  if (/iPhone|iPad|iPod/.test(e.ua) || (mac && e.touchPoints > 1)) return 'ios';
  if (mac && /Version\/[\d.]+ Safari/.test(e.ua) && !/Chrome|Chromium|Edg\//.test(e.ua)) return 'mac-safari';
  return null;
}

type PromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
const deferred = ref<PromptEvent | null>(null);
const installed = ref(false);

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep it for the button rather than the browser's own banner
    deferred.value = e as PromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    installed.value = true;
    deferred.value = null;
  });
}

export const install = computed<InstallMode>(() =>
  typeof window === 'undefined'
    ? null
    : installMode({
        ua: navigator.userAgent,
        touchPoints: navigator.maxTouchPoints ?? 0,
        standalone: installed.value || matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
        desktopApp: Boolean(window.calmeDesktop),
        canPrompt: Boolean(deferred.value),
      }),
);

/** Opens the browser's install prompt; true when the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred.value;
  if (!e) return false;
  deferred.value = null; // a prompt can be shown only once
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted';
}
