import { describe, expect, it } from 'vitest';
import { openArchive } from '../src/archive.ts';
import { syncArchive } from '../src/archiveSync.ts';
import { openStore } from '../src/store.ts';
import { fakeGmail } from './fakeGmail.ts';
import { mail } from './fixtures.ts';

function setup() {
  const s = openStore(':memory:');
  const a = openArchive(s.db);
  const g = fakeGmail();
  g.state.pages = {
    recent: { ids: ['new1'] },
    first: { ids: ['o1', 'o2', 'o3'], next: 'p2' },
    p2: { ids: ['o4'] },
  };
  return { s, a, g };
}

describe('syncArchive', () => {
  it('copies inbox mails already fetched, then adds recent mail without refetching known ones', async () => {
    const { s, a, g } = setup();
    s.upsertMessages([mail('inbox1')]);
    const r = await syncArchive(g.port, s, a, { months: 12, batch: 0 });
    expect(a.has('inbox1')).toBe(true);
    expect(a.has('new1')).toBe(true);
    expect(r.added).toBe(2);
    expect(g.calls.filter((c) => c.method === 'get').map((c) => c.args[0])).toEqual(['new1']);
  });

  it('backfills page by page within the batch budget and resumes later', async () => {
    const { s, a, g } = setup();
    await syncArchive(g.port, s, a, { months: 12, batch: 2 });
    expect(['o1', 'o2', 'o3'].filter((id) => a.has(id))).toEqual(['o1', 'o2']);
    // Leftover budget carries on to the next page within the same call.
    const r = await syncArchive(g.port, s, a, { months: 12, batch: 2 });
    expect(a.has('o3')).toBe(true);
    expect(a.has('o4')).toBe(true);
    expect(r.done).toBe(true);
    const gets = g.calls.filter((c) => c.method === 'get').length;
    await syncArchive(g.port, s, a, { months: 12, batch: 2 });
    expect(g.calls.filter((c) => c.method === 'get').length).toBe(gets);
  });

  it('restarts the backfill when the depth changes', async () => {
    const { s, a, g } = setup();
    for (let i = 0; i < 4; i++) await syncArchive(g.port, s, a, { months: 12, batch: 5 });
    const before = g.calls.length;
    await syncArchive(g.port, s, a, { months: 24, batch: 5 });
    const pages = g.calls.slice(before).filter((c) => c.method === 'listPage' && String(c.args[0]).startsWith('after:'));
    expect(pages[0].args[1]).toBeUndefined();
    expect(s.getMeta('archiveMonths')).toBe('24');
  });
});
