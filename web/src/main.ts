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
createApp(App).use(i18n).mount('#root');
