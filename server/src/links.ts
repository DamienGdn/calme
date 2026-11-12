import { decodeEntities } from './mime.ts';

/**
 * The link behind Calm's suggested action ("→ read it on EcoleDirecte"): one of the mail's own links whose text or
 * site matches the action's words. Only http(s) links; never unsubscribe links. No AI involved: it works for every
 * mail already sorted.
 */
export interface ActionLink {
  url: string;
  label: string;
  host: string;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STOP = new Set(['dans', 'pour', 'avec', 'votre', 'vous', 'cette', 'plus', 'rapidement', 'avant', 'apres', 'faire', 'sans', 'tout', 'tous', 'leur', 'from', 'with', 'your', 'this', 'that', 'quickly']);
const UNSUB = /unsub|desabonn|desinscri|optout|opt-out|preferences|preferences/i;

function links(html: string, text: string): { url: string; label: string }[] {
  const out: { url: string; label: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    out.push({ url: decodeEntities(m[1]).trim(), label: decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() });
  }
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) out.push({ url: m[0].replace(/[.,;:!?]+$/, ''), label: '' });
  return out;
}

export function actionLink(action: string, html: string, text: string): ActionLink | null {
  const words = fold(action).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w));
  if (!words.length) return null;
  let best: (ActionLink & { score: number }) | null = null;
  for (const l of links(html, text)) {
    let u: URL;
    try {
      u = new URL(l.url);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || UNSUB.test(fold(`${l.url} ${l.label}`))) continue;
    const host = u.hostname.replace(/^www\./, '');
    const hay = fold(`${l.label} ${host}`);
    const score = words.filter((w) => hay.includes(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { url: u.href, label: l.label || host, host, score };
  }
  return best ? { url: best.url, label: best.label, host: best.host } : null;
}

/** The action's link, else one matching what Calm read in the mail (its summary). */
export function mailLink(a: { action: string; summary: string[] } | null | undefined, html: string, text: string): (ActionLink & { via: 'action' | 'summary' }) | null {
  if (!a) return null;
  const byAction = actionLink(a.action, html, text);
  if (byAction) return { ...byAction, via: 'action' };
  const bySummary = actionLink(a.summary.join(' '), html, text);
  return bySummary ? { ...bySummary, via: 'summary' } : null;
}
