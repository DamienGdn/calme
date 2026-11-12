import { sendNotification } from 'web-push';
import { getSettings } from './settings.ts';
import type { Reminders } from './reminders.ts';
import type { Store } from './store.ts';
import type { Analysis, PushSub } from './types.ts';

export interface Alert {
  id: string;
  title: string;
  body: string;
  url: string;
  at: number;
}

export type PushSender = (sub: PushSub, payload: string) => Promise<unknown>;

export interface Notifier {
  /** Pushes newly sorted mails to subscribed phones, following the push mode and quiet hours. */
  notifyReplies(a: Analysis[]): Promise<void>;
  /**
   * Warns of reminders: ahead when asked (an hour, a day before), then at their time; once each, held back during
   * quiet hours. Pushed to phones unless notifications are off, and kept as alerts for the apps (Mac, open pages).
   */
  notifyReminders(r: Reminders): Promise<void>;
  /** Reminder alerts of the last day, newest last: the Mac app and open pages show the ones they have not shown. */
  alerts(): Alert[];
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

  /** Each push also carries the number of mails to answer, shown on the app icon (iPhone home screen). */
  async function push(payloads: { title: string; body: string; url: string }[]) {
    const badge = s.counts().reply;
    for (const sub of s.listPushSubs()) {
      for (const p of payloads) {
        try {
          await sender(sub, JSON.stringify({ ...p, badge }));
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
  }

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
      await push(payloads);
    },

    async notifyReminders(r) {
      const st = getSettings(s, { model: '', intervalMin: 0 });
      const t = now().getTime();
      const early = r.soon(t);
      const due = r.due(t);
      if ((!early.length && !due.length) || inQuietHours(now().getHours(), st.quietStart, st.quietEnd)) return;
      r.markNotified(early.map((x) => x.id), 'early');
      r.markNotified(due.map((x) => x.id), 'due');
      const en = st.language === 'en';
      const word = en ? 'Reminder' : 'Rappel';
      const fmt = new Intl.DateTimeFormat(en ? 'en-GB' : 'fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const payloads = [
        ...early.map((x) => ({ title: `${word} · ${fmt.format(new Date(x.due!))}`, body: x.text, url: '/#/rappels' })),
        ...due.map((x) => ({ title: word, body: x.text, url: '/#/rappels' })),
      ];
      const kept = this.alerts().filter((a) => t - a.at < 86400_000);
      let n = 0;
      for (const p of payloads) kept.push({ ...p, id: `${t}-${n++}`, at: t });
      s.setMeta('alerts', JSON.stringify(kept.slice(-30)));
      if (st.pushMode !== 'off') await push(payloads);
    },

    alerts() {
      const list = JSON.parse(s.getMeta('alerts') ?? '[]') as Alert[];
      return list.filter((a) => now().getTime() - a.at < 86400_000);
    },

    async test(endpoint) {
      const sub = s.listPushSubs().find((x) => x.endpoint === endpoint);
      if (!sub) return false;
      const en = getSettings(s, { model: '', intervalMin: 0 }).language === 'en';
      const badge = s.counts().reply;
      await sender(sub, JSON.stringify({ title: 'Calm', body: en ? 'Notifications work on this device.' : 'Les notifications fonctionnent sur cet appareil.', url: '/', badge }));
      return true;
    },
  };
}
