import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Store } from './store.ts';

export interface BackupFile {
  name: string;
  size: number;
  date: number;
}

const PATTERN = /^calme-\d{4}-\d{2}-\d{2}\.db$/;

/** iCloud Drive › Calm when iCloud Drive exists (macOS; the older "Calme" folder if it is already there), else ~/.calme/backups. */
export function defaultBackupDir(home: string): string {
  const icloud = join(homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
  if (!existsSync(icloud)) return join(home, 'backups');
  const before = join(icloud, 'Calme');
  return existsSync(before) ? before : join(icloud, 'Calm');
}

/** Consistent snapshot of the live database (SQLite VACUUM INTO), one file per day. */
export function backupNow(s: Store, dir: string, now = new Date()): BackupFile {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = `calme-${now.toISOString().slice(0, 10)}.db`;
  const path = join(dir, name);
  rmSync(path, { force: true });
  s.db.prepare('VACUUM INTO ?').run(path);
  const st = statSync(path);
  return { name, size: st.size, date: st.mtimeMs };
}

export function listBackups(dir: string): BackupFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => PATTERN.test(n))
    .map((name) => {
      const st = statSync(join(dir, name));
      return { name, size: st.size, date: st.mtimeMs };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

export function pruneBackups(dir: string, keep: number): void {
  for (const b of listBackups(dir).slice(keep)) rmSync(join(dir, b.name), { force: true });
}

/** Restoring swaps the database at the next start (the live one is open): stage the file now. */
export function stageRestore(dir: string, name: string, dbPath: string): void {
  if (!PATTERN.test(name) || !existsSync(join(dir, name))) throw new Error('Backup not found');
  const staged = `${dbPath}.restore`;
  rmSync(staged, { force: true });
  copyFileSync(join(dir, name), staged);
}

/** Called before opening the database: applies a staged restore, keeping the replaced file as .before-restore. */
export function applyStagedRestore(dbPath: string): boolean {
  const staged = `${dbPath}.restore`;
  if (!existsSync(staged)) return false;
  if (existsSync(dbPath)) renameSync(dbPath, `${dbPath}.before-restore`);
  for (const ext of ['-wal', '-shm']) rmSync(dbPath + ext, { force: true });
  renameSync(staged, dbPath);
  return true;
}
