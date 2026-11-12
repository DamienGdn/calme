import type { DatabaseSync } from 'node:sqlite';

/**
 * Logos of the organisations that send mail (LinkedIn, Ameli…), shown at the start of each row like Apple Mail.
 * Calm asks the sender's own site for its icon (apple-touch-icon, the page's declared icon, then favicon.ico), never a
 * third-party service, and keeps it in its database. Personal addresses (gmail.com…) have no logo: the row shows an
 * initial instead.
 */

/** Mail providers of individuals: their icon would say nothing about the sender. */
const PERSONAL = new Set(
  ('gmail.com googlemail.com outlook.com outlook.fr hotmail.com hotmail.fr live.com live.fr msn.com yahoo.com yahoo.fr ' +
    'icloud.com me.com mac.com orange.fr wanadoo.fr free.fr sfr.fr neuf.fr laposte.net bbox.fr numericable.fr ' +
    'proton.me protonmail.com gmx.fr gmx.com gmx.de aol.com aol.fr hey.com fastmail.com yandex.com zoho.com').split(' '),
);
/** Second-level labels under which an organisation sits one level lower (example.co.uk, ville.gouv.fr). */
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gouv', 'gov', 'ac', 'edu', 'asso', 'nom']);

/** The organisation's domain from a mail domain (news.linkedin.com → linkedin.com), or null when there is none. */
export function orgDomain(raw: string): string | null {
  const host = raw.trim().toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || /^\d+(\.\d+)+$/.test(host) || /\.(local|localhost|internal|lan|home|test)$/.test(host)) return null;
  const parts = host.split('.');
  const keep = parts.length >= 3 && parts.at(-1)!.length === 2 && SECOND_LEVEL.has(parts.at(-2)!) ? 3 : 2;
  const org = parts.slice(-keep).join('.');
  return PERSONAL.has(org) ? null : org;
}

const MAX_BYTES = 100 * 1024;
const OK_FOR = 30 * 86400_000;
const NONE_FOR = 7 * 86400_000;

export function openLogos(db: DatabaseSync, fetchImpl: typeof fetch = fetch) {
  db.exec('CREATE TABLE IF NOT EXISTS logos (domain TEXT PRIMARY KEY, data TEXT, at INTEGER NOT NULL)');

  async function image(url: string): Promise<string | null> {
    try {
      const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(4000) });
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!res.ok || !type.startsWith('image/') || type === 'image/svg+xml') return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_BYTES) return null;
      return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
    } catch {
      return null;
    }
  }

  /** The icon the home page declares (the largest apple-touch-icon or icon link), as an https URL. */
  async function declared(domain: string): Promise<string[]> {
    try {
      const res = await fetchImpl(`https://${domain}/`, { redirect: 'follow', signal: AbortSignal.timeout(4000) });
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return [];
      const html = (await res.text()).slice(0, 200_000);
      const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
      const pick = (re: RegExp) =>
        links
          .filter((l) => re.test(/\brel\s*=\s*["']?([^"'>]+)/i.exec(l)?.[1] ?? ''))
          .map((l) => ({ href: /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(l)?.[1] ?? '', size: Number(/\bsizes\s*=\s*["']?(\d+)/i.exec(l)?.[1] ?? 0) }))
          .filter((l) => l.href && !l.href.startsWith('data:') && !/\.svg(\?|$)/i.test(l.href))
          .sort((a, b) => b.size - a.size);
      return [...pick(/apple-touch-icon/i), ...pick(/(^|\s)icon(\s|$)/i)]
        .map((l) => {
          try {
            return new URL(l.href, res.url || `https://${domain}/`).href;
          } catch {
            return '';
          }
        })
        .filter((u) => u.startsWith('https://'));
    } catch {
      return [];
    }
  }

  async function find(domain: string): Promise<string | null> {
    for (const url of [`https://${domain}/apple-touch-icon.png`]) {
      const got = await image(url);
      if (got) return got;
    }
    for (const url of (await declared(domain)).slice(0, 3)) {
      const got = await image(url);
      if (got) return got;
    }
    return image(`https://${domain}/favicon.ico`);
  }

  const inflight = new Map<string, Promise<string | null>>();
  async function logo(org: string, now: number): Promise<string | null> {
    const row = db.prepare('SELECT data, at FROM logos WHERE domain = ?').get(org) as { data: string | null; at: number } | undefined;
    if (row && now - row.at < (row.data ? OK_FOR : NONE_FOR)) return row.data;
    let p = inflight.get(org);
    if (!p) {
      p = find(org).then((data) => {
        db.prepare('INSERT OR REPLACE INTO logos (domain, data, at) VALUES (?, ?, ?)').run(org, data, Date.now());
        inflight.delete(org);
        return data;
      });
      inflight.set(org, p);
    }
    return p;
  }

  return {
    /** Logo (data URL) or null for each mail domain asked, 40 at most. */
    async forDomains(domains: string[], now = Date.now()): Promise<Record<string, string | null>> {
      const out: Record<string, string | null> = {};
      await Promise.all(
        [...new Set(domains)].slice(0, 40).map(async (d) => {
          const org = orgDomain(d);
          out[d] = org ? await logo(org, now) : null;
        }),
      );
      return out;
    },
  };
}
