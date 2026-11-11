import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generateVAPIDKeys } from 'web-push';

export interface Config {
  home: string;
  port: number;
  model: string;
  intervalMin: number;
  pairingToken: string;
  vapid: { publicKey: string; privateKey: string };
}

export function writePrivate(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function loadConfig(home = process.env.CALME_HOME || join(homedir(), '.calme')): Config {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = join(home, 'config.json');
  let stored: Pick<Config, 'pairingToken' | 'vapid'>;
  if (existsSync(file)) {
    stored = JSON.parse(readFileSync(file, 'utf8'));
  } else {
    stored = { pairingToken: randomBytes(32).toString('hex'), vapid: generateVAPIDKeys() };
    writePrivate(file, JSON.stringify(stored, null, 2));
  }
  return {
    home,
    port: Number(process.env.CALME_PORT || 4747),
    model: process.env.CALME_MODEL || 'sonnet',
    intervalMin: Number(process.env.CALME_INTERVAL_MIN || 5),
    ...stored,
  };
}
