// Bundles the Calme server (TypeScript + deps) into one CommonJS file run by Electron's own Node,
// and copies the built web UI next to it. Output: desktop/app/{server.cjs,web/}.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const out = join(here, '../app');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, 'server/src/main.ts')],
  outfile: join(out, 'server.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  logLevel: 'warning',
  // import.meta.url is only read when CALME_WEB_DIST is unset, which never happens in the app.
  logOverride: { 'empty-import-meta': 'silent' },
});

const web = join(root, 'web/dist');
if (!existsSync(join(web, 'index.html'))) throw new Error('web/dist manquant : lance `pnpm build` à la racine');
cpSync(web, join(out, 'web'), { recursive: true });
console.log('server bundle + web ok →', out);
