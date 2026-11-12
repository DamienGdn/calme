import { createApp } from 'vue';
import App from './App.vue';
import { linkManifest, setToken } from './api.ts';
import { i18n } from './i18n.ts';
import './styles.css';

document.documentElement.lang = i18n.global.locale.value;

// Pairing from the QR code shown in Admin › iPhone: #pair=<token>.
const pair = /^#pair=([0-9a-f]{16,128})$/i.exec(location.hash);
if (pair) {
  setToken(pair[1]);
  history.replaceState(null, '', '/#/tri');
} else linkManifest();
// The app does not zoom like a web page: iOS ignores user-scalable=no, so pinch gestures are stopped here
// (double-tap zoom is off through touch-action, focus zoom through 16px fields; see styles.css).
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
// On a phone the on-screen keyboard takes the bottom of the screen: the menu bar and the Écrire button step aside
// while a text field has focus (a short delay on blur, so moving from one field to the next does not flicker).
const touch = matchMedia('(pointer: coarse)');
const typing = (el: Element | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLInputElement && !/^(?:checkbox|radio|range|button|submit|reset|file|color|image)$/.test(el.type)));
const keyboard = () => document.documentElement.classList.toggle('kb-open', touch.matches && typing(document.activeElement));
document.addEventListener('focusin', keyboard);
document.addEventListener('focusout', () => setTimeout(keyboard, 80));
createApp(App).use(i18n).mount('#root');
