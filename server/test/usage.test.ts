import { describe, expect, it } from 'vitest';
import { openStore } from '../src/store.ts';
import { openUsage, usageFrom, usageKind } from '../src/usage.ts';

describe('AI usage', () => {
  it('reads cost and tokens from a claude -p answer', () => {
    expect(usageFrom({ total_cost_usd: 0.0123, duration_ms: 4200, usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 } }))
      .toEqual({ cost: 0.0123, input: 1110, output: 50, ms: 4200 });
    expect(usageFrom({})).toEqual({ cost: 0, input: 0, output: 0, ms: 0 });
  });

  it('names what each call was for, from its answer schema', () => {
    expect(usageKind({ properties: { analyses: {} } })).toBe('triage');
    expect(usageKind({ properties: { gmailQuery: {} } })).toBe('search');
    expect(usageKind({ properties: { lead: {}, sections: {} } })).toBe('search');
    expect(usageKind({ properties: { glance: {} } })).toBe('agenda');
    expect(usageKind({ properties: { remindAt: {} } })).toBe('reminder');
    expect(usageKind({ properties: { slots: {} } })).toBe('writing');
    expect(usageKind({ properties: { subject: {}, body: {} } })).toBe('writing');
    expect(usageKind({ properties: { zzz: {} } })).toBe('other');
  });

  it('adds up today, the last 7 days and this month, per day and per use', () => {
    const u = openUsage(openStore(':memory:').db);
    const at = (d: number, h = 10) => new Date(2026, 10, d, h).getTime();
    u.record('triage', { cost: 0.1, input: 1000, output: 100, ms: 1 }, at(12));
    u.record('search', { cost: 0.05, input: 500, output: 50, ms: 1 }, at(12, 8));
    u.record('triage', { cost: 0.2, input: 2000, output: 200, ms: 1 }, at(8));
    u.record('triage', { cost: 1, input: 1, output: 1, ms: 1 }, at(1));
    u.record('triage', { cost: 9, input: 1, output: 1, ms: 1 }, new Date(2026, 9, 20).getTime());
    const s = u.summary(new Date(2026, 10, 12, 18));
    expect(s.today).toEqual({ cost: 0.15, calls: 2 });
    expect(s.week).toEqual({ cost: 0.35, calls: 3 });
    expect(s.month).toEqual({ cost: 1.35, calls: 4 });
    expect(s.days).toHaveLength(30);
    expect(s.days.at(-1)).toEqual({ day: '2026-11-12', cost: 0.15, calls: 2 });
    expect(s.byKind[0]).toMatchObject({ kind: 'triage', calls: 4, cost: 10.3 });
    expect(s.byKind[1]).toMatchObject({ kind: 'search', calls: 1 });
  });
});
