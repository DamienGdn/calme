import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './api.ts';
import { createRuntime } from './runtime.ts';

const rt = createRuntime();
const app = createApp({
  store: rt.store,
  archive: rt.archive,
  backup: rt.backup,
  remote: rt.remote,
  // The desktop app relaunches the server when it exits; from a terminal, start it again by hand.
  restart: () => setTimeout(() => process.exit(0), 300),
  gmail: rt.gmail,
  oauth: rt.oauth,
  runner: rt.runner,
  cfg: rt.cfg,
  notifier: rt.notifier,
  runCycle: () => rt.runCycle(),
  status: rt.status,
  calendar: rt.calendar,
  claudeInfo: rt.claudeInfo,
  claudeTest: rt.claudeTest,
});

// The desktop app ships the built web UI next to the bundled server and points to it.
const webDist = process.env.CALME_WEB_DIST ?? join(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(webDist)) {
  const root = process.env.CALME_WEB_DIST ? webDist : relative(process.cwd(), webDist) || '.';
  app.use('/*', serveStatic({ root }));
  const index = readFileSync(join(webDist, 'index.html'), 'utf8');
  app.get('*', (c) => c.html(index));
} else {
  app.get('/', (c) => c.text('Interface non construite : lance `pnpm build` à la racine du projet.'));
}

serve({ fetch: app.fetch, hostname: '127.0.0.1', port: rt.cfg.port }, () => {
  console.log(`Calme écoute sur http://127.0.0.1:${rt.cfg.port}`);
  console.log(`Jeton d’appairage : pnpm calme pair`);
  if (!rt.oauth.hasCredentials()) console.log(`Gmail : dépose credentials.json dans ${rt.cfg.home} (voir README)`);
  else if (!rt.oauth.isConnected()) console.log(`Gmail : ouvre http://127.0.0.1:${rt.cfg.port}/auth/google sur ce PC`);
});

// Interval read from settings before each wait, so the admin page can change it live.
async function loop(): Promise<void> {
  await rt.runCycle();
  setTimeout(loop, rt.settings().intervalMin * 60_000);
}
void loop();
