<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api.ts';
import { dateLocale } from '../i18n.ts';

/** Live Gmail quota gauge (units used over the last minute), refreshed every 5 s while the page is visible. */
const props = defineProps<{ compact?: boolean }>();
const { t } = useI18n();
const q = ref<{ used: number; budget: number; limit: number; waiting: number } | null>(null);

const tick = () => {
  if (document.visibilityState !== 'visible') return;
  api<typeof q.value>('/api/quota').then((v) => (q.value = v)).catch(() => {});
};
let timer = 0;
onMounted(() => {
  tick();
  timer = window.setInterval(tick, 5000);
  document.addEventListener('visibilitychange', tick);
});
onBeforeUnmount(() => {
  window.clearInterval(timer);
  document.removeEventListener('visibilitychange', tick);
});

const pct = computed(() => (q.value ? Math.min(100, Math.round((q.value.used / q.value.limit) * 100)) : 0));
const level = computed(() => (pct.value >= 90 ? 'high' : pct.value >= 60 ? 'mid' : 'low'));
const label = computed(() => {
  if (!q.value) return '';
  if (q.value.waiting > 2 || q.value.used >= q.value.budget * 0.95) return t('quota.slowing');
  return level.value === 'high' ? t('quota.high') : level.value === 'mid' ? t('quota.mid') : t('quota.ok');
});
const fmt = (n: number) => n.toLocaleString(dateLocale());
</script>

<template>
  <div
    v-if="q"
    :class="['quota', `q-${level}`]"
    role="meter"
    :aria-label="t('quota.aria')"
    :aria-valuemin="0"
    :aria-valuemax="q.limit"
    :aria-valuenow="q.used"
    :aria-valuetext="`${q.used} / ${q.limit} — ${label}`"
  >
    <div class="quota-top">
      <span class="eyebrow" style="padding: 0">{{ t('quota.title') }}</span>
      <span class="mono" style="font-size: 11px">{{ fmt(q.used) }} / {{ fmt(q.limit) }}</span>
    </div>
    <div class="quota-track" aria-hidden="true">
      <span :style="{ width: `${pct}%` }" />
      <i :style="{ left: `${Math.round((q.budget / q.limit) * 100)}%` }" />
    </div>
    <span v-if="!props.compact" class="quota-label">{{ label }} · {{ t('quota.perMinute') }}</span>
  </div>
</template>
