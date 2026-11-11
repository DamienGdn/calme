import { mkdtempSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backupNow, listBackups, pruneBackups } from '../src/backup.ts';
import { openStore } from '../src/store.ts';
import { mail } from './fixtures.ts';

describe('backup', () => {
  it('writes a consistent copy of the database that can be reopened', () => {
    const dir = mkdtempSync(join(tmpdir(), 'calme-bk-'));
    const s = openStore(join(dir, 'calme.db'));
    s.upsertMessages([mail('a')]);
    const out = join(dir, 'backups');
    const b = backupNow(s, out, new Date('2026-11-12T03:00:00Z'));
    expect(b.name).toBe('calme-2026-11-12.db');
    expect(openStore(join(out, b.name)).listInbox().map((m) => m.id)).toEqual(['a']);
    expect(listBackups(out).map((x) => x.name)).toEqual(['calme-2026-11-12.db']);
  });

  it('keeps only the most recent backups', () => {
    const dir = mkdtempSync(join(tmpdir(), 'calme-bk-'));
    const s = openStore(join(dir, 'calme.db'));
    const out = join(dir, 'backups');
    for (let d = 1; d <= 9; d++) {
      const b = backupNow(s, out, new Date(`2026-11-0${d}T03:00:00Z`));
      utimesSync(join(out, b.name), new Date(2026, 10, d), new Date(2026, 10, d));
    }
    pruneBackups(out, 7);
    const names = readdirSync(out).sort();
    expect(names).toHaveLength(7);
    expect(names[0]).toBe('calme-2026-11-03.db');
  });
});
