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
createApp(App).use(i18n).mount('#root');
