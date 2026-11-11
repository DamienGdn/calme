import { sendNotification } from 'web-push';
import { getSettings } from './settings.ts';
import type { Store } from './store.ts';
import type { Analysis, PushSub } from './types.ts';

export type PushSender = (sub: PushSub, payload: string) => Promise<unknown>;

export interface Notifier {
  /** Pushes newly sorted mails to subscribed phones, following the push mode and quiet hours. */
  notifyReplies(a: Analysis[]): Promise<void>;
  test(endpoint: string): Promise<boolean>;
}

function inQuietHours(h: number, start: number | null, end: number | null): boolean {
  if (start === null || end === null || start === end) return false;
  return start < end ? h >= start && h < end : h >= start || h < end;
}

export function createNotifier(
  s: Store,
  vapid: { publicKey: string; privateKey: string },
  send?: PushSender,
  now: () => Date = () => new Date(),
): Notifier {
  const subject = process.env.CALME_PUSH_SUBJECT || 'mailto:calme-push@users.noreply.github.com';
  const sender: PushSender =
    send ?? ((sub, payload) => sendNotification(sub, payload, { vapidDetails: { subject, ...vapid }, TTL: 3600 }));

  return {
    async notifyReplies(list) {
      const st = getSettings(s, { model: '', intervalMin: 0 });
      if (st.pushMode === 'off' || inQuietHours(now().getHours(), st.quietStart, st.quietEnd)) return;
      const wanted = (c: string) => (st.pushMode === 'all' ? c !== 'trash' : c === 'reply');
      const mails = list.filter((a) => wanted(a.category)).map((a) => s.getMail(a.id)).filter((m) => m !== null);
      if (!mails.length) return;
      const payloads =
        mails.length > 3
          ? [{ title: st.language === 'en' ? (st.pushMode === 'all' ? `${mails.length} new mails` : `${mails.length} mails are waiting for your answer`) : st.pushMode === 'all' ? `${mails.length} nouveaux mails` : `${mails.length} mails attendent ta réponse`, body: mails.map((m) => m.fromName).slice(0, 4).join(', '), url: '/' }]
          : mails.map((m) => ({ title: m.fromName, body: m.subject, url: `/?mail=${encodeURIComponent(m.id)}` }));
      for (const sub of s.listPushSubs()) {
        for (const p of payloads) {
          try {
            await sender(sub, JSON.stringify(p));
          } catch (e) {
            const code = (e as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) {
              s.removePushSub(sub.endpoint);
              break;
            }
            console.error(`[push] échec : ${(e as Error).message}`);
          }
        }
      }
    },
    async test(endpoint) {
      const sub = s.listPushSubs().find((x) => x.endpoint === endpoint);
      if (!sub) return false;
      const en = getSettings(s, { model: '', intervalMin: 0 }).language === 'en';
      await sender(sub, JSON.stringify({ title: 'Calm', body: en ? 'Notifications work on this device.' : 'Les notifications fonctionnent sur cet appareil.', url: '/' }));
      return true;
    },
  };
}
