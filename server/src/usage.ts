import type { DatabaseSync } from 'node:sqlite';

/**
 * What Calm's use of Claude costs, call by call: the API-price equivalent that `claude -p` reports
 * (total_cost_usd) and its tokens. On a Claude subscription nothing is billed per call; this shows the scale of use.
 */
export interface Usage {
  cost: number;
  input: number;
  output: number;
  ms: number;
}

/** Reads cost and tokens from a `claude -p --output-format json` answer (cached input tokens count as input). */
export function usageFrom(res: unknown): Usage {
  const r = (res ?? {}) as { total_cost_usd?: unknown; duration_ms?: unknown; usage?: Record<string, unknown> };
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const u = r.usage ?? {};
  return {
    cost: n(r.total_cost_usd),
    input: n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens),
    output: n(u.output_tokens),
    ms: n(r.duration_ms),
  };
}

/** What a call was for, told by the answer it asks for. */
export function usageKind(schema: object): string {
  const s = JSON.stringify(schema);
  const has = (k: string) => s.includes(`"${k}"`);
  if (has('analyses') || has('category')) return 'triage';
  if (has('gmailQuery') || has('sections')) return 'search';
  if (has('glance')) return 'agenda';
  if (has('remindAt')) return 'reminder';
  if (has('slots') || has('body') || has('draft') || has('questions') || has('subject')) return 'writing';
  if (has('verdict') || has('advice')) return 'newsletters';
  return 'other';
}

const day = (t: number) => new Date(t).toLocaleDateString('sv-SE');
const round = (x: number) => Math.round(x * 1e6) / 1e6;

export function openUsage(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS ai_usage (at INTEGER NOT NULL, kind TEXT NOT NULL, cost REAL NOT NULL, input INTEGER NOT NULL, output INTEGER NOT NULL, ms INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS ai_usage_at ON ai_usage(at);`);
  return {
    record(kind: string, u: Usage, at = Date.now()): void {
      db.prepare('INSERT INTO ai_usage (at, kind, cost, input, output, ms) VALUES (?, ?, ?, ?, ?, ?)').run(at, kind, u.cost, u.input, u.output, u.ms);
    },

    /** Today, the last 7 days, this month; the last 30 days day by day; and the last 30 days per use. */
    summary(now = new Date()) {
      const start = (d: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - d).getTime();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const from = Math.min(start(29), monthStart);
      const rows = db.prepare('SELECT at, kind, cost, input, output FROM ai_usage WHERE at >= ? AND at <= ?').all(from, now.getTime()) as {
        at: number;
        kind: string;
        cost: number;
        input: number;
        output: number;
      }[];
      const sum = (since: number) => {
        const r = rows.filter((x) => x.at >= since);
        return { cost: round(r.reduce((n, x) => n + x.cost, 0)), calls: r.length };
      };
      const days = Array.from({ length: 30 }, (_, i) => {
        const key = day(start(29 - i));
        const r = rows.filter((x) => x.at >= start(29) && day(x.at) === key);
        return { day: key, cost: round(r.reduce((n, x) => n + x.cost, 0)), calls: r.length };
      });
      const kinds = new Map<string, { kind: string; cost: number; calls: number; input: number; output: number }>();
      for (const x of rows.filter((r) => r.at >= start(29))) {
        const k = kinds.get(x.kind) ?? { kind: x.kind, cost: 0, calls: 0, input: 0, output: 0 };
        k.cost += x.cost;
        k.calls++;
        k.input += x.input;
        k.output += x.output;
        kinds.set(x.kind, k);
      }
      return {
        today: sum(start(0)),
        week: sum(start(6)),
        month: sum(monthStart),
        days,
        byKind: [...kinds.values()].map((k) => ({ ...k, cost: round(k.cost) })).sort((a, b) => b.cost - a.cost),
      };
    },
  };
}
