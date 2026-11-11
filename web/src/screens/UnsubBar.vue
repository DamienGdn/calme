<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { post, type MailItem } from '../api.ts';
import { notify, notifyError } from '../store.ts';

const props = defineProps<{ mail: MailItem }>();
const { t } = useI18n();
const status = ref<'idle' | 'busy' | 'done'>('idle');
const link = computed(() => [props.mail.unsub?.httpUrl, props.mail.unsub?.oneClickUrl].find((u) => u && /^https:/i.test(u)));

async function go() {
  status.value = 'busy';
  try {
    const r = await post<{ unsubscribed: number; toOpen: string[] }>('/api/newsletters/unsubscribe', { senders: [props.mail.fromEmail] });
    if (r.unsubscribed) {
      status.value = 'done';
      notify(t('reader.unsubDone', { name: props.mail.fromName }));
    } else {
      status.value = 'idle';
      if (r.toOpen[0]) window.open(r.toOpen[0], '_blank', 'noopener,noreferrer');
      notify(t('reader.unsubConfirm'));
    }
  } catch (e) {
    status.value = 'idle';
    notifyError(e);
  }
}
</script>

<template>
  <section class="unsub-bar" :aria-label="t('reader.newsletter')">
    <span style="flex: 1 1 220px; font-size: 14px">
      <strong>{{ t('reader.newsletter') }}</strong> <span class="muted">· {{ mail.fromEmail }}</span>
    </span>
    <a v-if="link" class="btn" :href="link" target="_blank" rel="noopener noreferrer">{{ t('reader.unsubLink') }}</a>
    <button type="button" class="btn btn-prim" :disabled="status !== 'idle'" @click="go">
      {{ status === 'done' ? t('reader.unsubscribed') : status === 'busy' ? t('reader.unsubscribing') : t('reader.unsubscribe') }}
    </button>
  </section>
</template>
