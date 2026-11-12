<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { type MailItem } from '../api.ts';
import { useUnsubscribe } from '../unsub.ts';

const props = defineProps<{ mail: MailItem }>();
const { t } = useI18n();
const { status, go } = useUnsubscribe(() => props.mail);
const link = computed(() => [props.mail.unsub?.httpUrl, props.mail.unsub?.oneClickUrl].find((u) => u && /^https:/i.test(u)));
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
