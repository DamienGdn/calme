import { sendNotification } from 'web-push';
import { getSettings } from './settings.ts';
import type { Store } from './store.ts';
import type { Analysis, PushSub } from './types.ts';

export type PushSender = (sub: PushSub, payload: string) => Promise<unknown>;

export interface Notifier {
  notifyReplies(a: Analysis[]): Promise<void>;
}

export function createNotifier(s: Store, vapid: { publicKey: string; privateKey: string }, send?: PushSender): Notifier {
  const subject = process.env.CALME_PUSH_SUBJECT || 'mailto:calme-push@users.noreply.github.com';
  const sender: PushSender =
    send ?? ((sub, payload) => sendNotification(sub, payload, { vapidDetails: { subject, ...vapid }, TTL: 3600 }));

  return {
    async notifyReplies(list) {
      const mails = list.filter((a) => a.category === 'reply').map((a) => s.getMail(a.id)).filter((m) => m !== null);
      if (!mails.length) return;
      const payloads =
        mails.length > 3
          ? [{ title: getSettings(s, { model: '', intervalMin: 0 }).language === 'en' ? `${mails.length} mails are waiting for your answer` : `${mails.length} mails attendent ta réponse`, body: mails.map((m) => m.fromName).slice(0, 4).join(', '), url: '/' }]
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
  };
}
