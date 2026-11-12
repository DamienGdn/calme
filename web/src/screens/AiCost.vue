<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api.ts';
import { dateLocale } from '../i18n.ts';
import { notifyError } from '../store.ts';

/**
 * What Calm's use of Claude amounts to, at API prices (as Claude Code reports each call): three totals, the last 30
 * days day by day (one hue: a single measure), and the split by use. A table gives the same numbers.
 */
interface Total {
  cost: number;
  calls: number;
}
interface Summary {
  today: Total;
  week: Total;
  month: Total;
  days: { day: string; cost: number; calls: number }[];
  byKind: { kind: string; cost: number; calls: number; input: number; output: number }[];
}
const { t, te } = useI18n();
const data = ref<Summary | null>(null);
onMounted(() => api<Summary>('/api/ai-usage').then((d) => (data.value = d)).catch(notifyError));

const money = (x: number) =>
  new Intl.NumberFormat(dateLocale(), { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: x > 0 && x < 1 ? 3 : 2 }).format(x);
const shortDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' });
const longDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
const kindLabel = (k: string) => (te(`cost.kinds.${k}`) ? t(`cost.kinds.${k}`) : k);
const k = (n: number) => (n / 1000).toLocaleString(dateLocale(), { maximumFractionDigits: n < 10_000 ? 1 : 0 });

const max = computed(() => Math.max(0, ...(data.value?.days ?? []).map((d) => d.cost)));
const kindMax = computed(() => Math.max(0, ...(data.value?.byKind ?? []).map((x) => x.cost)));
const hovered = ref<number | null>(null);
const tiles = computed(() => (data.value ? ([['today', data.value.today], ['week', data.value.week], ['month', data.value.month]] as const) : []));
</script>

<template>
  <header class="topbar"><span class="eyebrow">{{ t('cost.eyebrow') }}</span></header>
  <h1 class="headline">{{ t('cost.headline') }} <em>{{ t('cost.headlineEm') }}</em></h1>

  <p v-if="!data" class="empty">{{ t('common.loading') }}</p>
  <template v-else>
    <div class="cost-tiles">
      <div v-for="[key, v] in tiles" :key="key" class="cost-tile">
        <span class="eyebrow">{{ t(`cost.${key}`) }}</span>
        <span class="cost-big">{{ money(v.cost) }}</span>
        <span class="muted mono" style="font-size: 12px">{{ t('cost.calls', v.calls) }}</span>
      </div>
    </div>

    <section class="cost-card" :aria-label="t('cost.perDay')">
      <div class="cost-card-head">
        <span class="eyebrow">{{ t('cost.perDay') }}</span>
        <span class="mono muted" style="font-size: 11px">max {{ money(max) }}</span>
      </div>
      <div class="cost-chart" @mouseleave="hovered = null">
        <div
          v-for="(d, i) in data.days"
          :key="d.day"
          class="cost-col"
          tabindex="0"
          :aria-label="`${longDay(d.day)} : ${money(d.cost)}, ${t('cost.calls', d.calls)}`"
          @mouseenter="hovered = i"
          @focus="hovered = i"
          @blur="hovered = null"
        >
          <span class="cost-bar" :style="{ height: max ? `${Math.max(d.cost > 0 ? 2 : 0, (d.cost / max) * 100)}%` : '0' }" />
          <span v-if="hovered === i" :class="['cost-tip', { left: i > 22, right: i < 7 }]" role="tooltip">
            <b>{{ longDay(d.day) }}</b> {{ money(d.cost) }} · {{ t('cost.calls', d.calls) }}
          </span>
        </div>
      </div>
      <div class="cost-axis mono">
        <span>{{ shortDay(data.days[0].day) }}</span><span>{{ shortDay(data.days[15].day) }}</span><span>{{ shortDay(data.days[29].day) }}</span>
      </div>
    </section>

    <section class="cost-card" :aria-label="t('cost.perUse')">
      <span class="eyebrow">{{ t('cost.perUse') }}</span>
      <p v-if="!data.byKind.length" class="muted" style="margin: 0">{{ t('cost.none') }}</p>
      <div v-for="x in data.byKind" :key="x.kind" class="cost-kind">
        <span class="cost-kind-name">{{ kindLabel(x.kind) }}</span>
        <span class="cost-kind-val mono">{{ money(x.cost) }}</span>
        <span class="cost-kind-track"><span :style="{ width: kindMax ? `${(x.cost / kindMax) * 100}%` : '0' }" /></span>
        <span class="muted mono cost-kind-meta">{{ t('cost.calls', x.calls) }} · {{ t('cost.tokens', { input: k(x.input), output: k(x.output) }) }}</span>
      </div>
    </section>

    <details class="cost-card">
      <summary class="eyebrow" style="cursor: pointer">{{ t('cost.table') }}</summary>
      <table class="cost-table">
        <thead><tr><th>{{ t('cost.day') }}</th><th>{{ t('cost.amount') }}</th><th>{{ t('cost.calls', 2).replace(/^\d+\s*/, '') }}</th></tr></thead>
        <tbody>
          <tr v-for="d in [...data.days].reverse()" :key="d.day"><td>{{ longDay(d.day) }}</td><td class="mono">{{ money(d.cost) }}</td><td class="mono">{{ d.calls }}</td></tr>
        </tbody>
      </table>
    </details>

    <p class="muted" style="margin: 0; font-size: 13px; line-height: 1.5; max-width: 62ch">{{ t('cost.note') }}</p>
  </template>
</template>
