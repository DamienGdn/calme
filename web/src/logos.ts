import { reactive } from 'vue';
import { post } from './api.ts';

/**
 * Logos of senders' organisations, asked from Calm in batches (the server fetches and keeps them): a data URL,
 * null when there is none (personal address, no icon), absent while not known yet.
 */
const known = reactive(new Map<string, string | null>());
const pending = new Set<string>();
let timer = 0;

const domainOf = (email: string) => email.split('@')[1]?.toLowerCase() ?? '';

export function logoFor(email: string): string | null | undefined {
  const d = domainOf(email);
  if (!d) return null;
  if (!known.has(d) && !pending.has(d)) {
    pending.add(d);
    window.clearTimeout(timer);
    timer = window.setTimeout(flush, 60);
  }
  return known.get(d);
}

async function flush() {
  const batch = [...pending].slice(0, 40);
  if (!batch.length) return;
  try {
    const got = await post<Record<string, string | null>>('/api/logos', { domains: batch });
    for (const d of batch) known.set(d, got[d] ?? null);
  } catch {
    for (const d of batch) known.set(d, null);
  } finally {
    for (const d of batch) pending.delete(d);
    if (pending.size) timer = window.setTimeout(flush, 60);
  }
}
