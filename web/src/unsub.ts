import { ref } from 'vue';
import { post, type MailItem } from './api.ts';
import { i18n } from './i18n.ts';
import { notify, notifyError } from './store.ts';

/** Unsubscribing from a mail's sender (one-click or mail when the sender offers it, else its page opens). */
export function useUnsubscribe(mail: () => MailItem) {
  const status = ref<'idle' | 'busy' | 'done'>('idle');
  async function go() {
    const m = mail();
    status.value = 'busy';
    try {
      const r = await post<{ unsubscribed: number; toOpen: string[] }>('/api/newsletters/unsubscribe', { senders: [m.fromEmail] });
      if (r.unsubscribed) {
        status.value = 'done';
        notify(i18n.global.t('reader.unsubDone', { name: m.fromName }));
      } else {
        status.value = 'idle';
        if (r.toOpen[0]) window.open(r.toOpen[0], '_blank', 'noopener,noreferrer');
        notify(i18n.global.t('reader.unsubConfirm'));
      }
    } catch (e) {
      status.value = 'idle';
      notifyError(e);
    }
  }
  return { status, go };
}
