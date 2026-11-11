import vue from '@vitejs/plugin-vue';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// The app's version is the desktop app's (released together).
const { version } = JSON.parse(readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [vue()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { proxy: { '/api': 'http://127.0.0.1:4747', '/manifest.webmanifest': 'http://127.0.0.1:4747' } },
});
