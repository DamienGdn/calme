<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api.ts';
import Icon from '../components/Icon.vue';
import { dateLocale } from '../i18n.ts';
import { notifyError } from '../store.ts';

interface CalEvent {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
}
export interface PendingEvent {
  title: string;
  start: string;
  end: string;
  conflict: boolean;
}
type Item = CalEvent & { kind: 'agenda' | 'proposed' | 'conflict' };

/** Week (hour grid) and month (6×7 grid) views over Google Calendar plus events proposed by mails. */
const props = defineProps<{ mode: 'semaine' | 'mois'; pending: PendingEvent[] }>();
const { t } = useI18n();

const DAY_START = 7;
const DAY_END = 22;
const HOUR_PX = 44;
const key = (d: Date) => d.toLocaleDateString('sv-SE');
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const monday = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};
const hm = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });

const anchor = ref(new Date());
const events = ref<CalEvent[] | null>(null);
const first = computed(() => (props.mode === 'semaine' ? monday(anchor.value) : monday(new Date(anchor.value.getFullYear(), anchor.value.getMonth(), 1))));
const days = computed(() => Array.from({ length: props.mode === 'semaine' ? 7 : 42 }, (_, i) => addDays(first.value, i)));
const range = computed(() => ({ from: key(days.value[0]), to: key(days.value[days.value.length - 1]) }));

watch(
  range,
  async ({ from, to }) => {
    events.value = null;
    try {
      events.value = (await api<{ events: CalEvent[] }>(`/api/agenda/range?from=${from}&to=${to}`)).events;
    } catch (e) {
      events.value = [];
      notifyError(e);
    }
  },
  { immediate: true },
);

const shift = (dir: number) =>
  (anchor.value = props.mode === 'semaine' ? addDays(anchor.value, 7 * dir) : new Date(anchor.value.getFullYear(), anchor.value.getMonth() + dir, 1));
const title = computed(() =>
  props.mode === 'semaine'
    ? t('agenda.cal.weekOf', { date: days.value[0].toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long' }) })
    : anchor.value.toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' }),
);
const weekdays = computed(() => days.value.slice(0, 7).map((d) => d.toLocaleDateString(dateLocale(), { weekday: 'short' })));

const byDay = computed(() => {
  const items: Item[] = [
    ...(events.value ?? []).map((e) => ({ ...e, kind: 'agenda' as const })),
    ...props.pending.map((p) => ({ title: p.title, start: p.start, end: p.end, allDay: false, kind: p.conflict ? ('conflict' as const) : ('proposed' as const) })),
  ];
  const map = new Map<string, Item[]>();
  const push = (k: string, it: Item) => map.set(k, [...(map.get(k) ?? []), it]);
  for (const it of items) {
    if (it.allDay) for (let d = new Date(it.start + 'T12:00:00'); key(d) < it.end; d = addDays(d, 1)) push(key(d), it);
    else push(key(new Date(it.start)), it);
  }
  return map;
});
const today = key(new Date());
const timed = (d: Date) => (byDay.value.get(key(d)) ?? []).filter((e) => !e.allDay);
const allDay = (d: Date) => (byDay.value.get(key(d)) ?? []).filter((e) => e.allDay);
function place(e: Item) {
  const s = new Date(e.start);
  const en = new Date(e.end);
  return {
    top: `${Math.max(0, (s.getHours() + s.getMinutes() / 60 - DAY_START) * HOUR_PX)}px`,
    height: `${Math.max(22, ((en.getTime() - s.getTime()) / 3_600_000) * HOUR_PX - 2)}px`,
  };
}
</script>

<template>
  <section class="cal" :aria-label="title">
    <div class="cal-head">
      <button type="button" class="btn btn-icon" :aria-label="mode === 'semaine' ? t('agenda.cal.prevWeek') : t('agenda.cal.prevMonth')" @click="shift(-1)"><Icon name="back" :size="16" /></button>
      <button type="button" class="btn" @click="anchor = new Date()">{{ t('common.today') }}</button>
      <button type="button" class="btn btn-icon" style="transform: scaleX(-1)" :aria-label="mode === 'semaine' ? t('agenda.cal.nextWeek') : t('agenda.cal.nextMonth')" @click="shift(1)">
        <Icon name="back" :size="16" />
      </button>
      <h2 class="serif" style="margin: 0; font-size: 30px; font-weight: 400; text-transform: capitalize">{{ title }}</h2>
      <span v-if="!events" class="muted" style="font-size: 13px">{{ t('common.loading') }}</span>
    </div>

    <div v-if="mode === 'mois'" class="month">
      <span v-for="w in weekdays" :key="w" class="month-wd mono">{{ w }}</span>
      <div v-for="d in days" :key="key(d)" :class="['month-cell', { out: d.getMonth() !== anchor.getMonth(), today: key(d) === today }]">
        <span class="month-n">{{ d.getDate() }}</span>
        <span
          v-for="(e, i) in (byDay.get(key(d)) ?? []).slice(0, 3)"
          :key="i"
          :class="['chip-ev', e.kind]"
          :title="`${e.allDay ? t('agenda.allDay') : `${hm(e.start)}–${hm(e.end)}`} · ${e.title}`"
        >
          <span v-if="!e.allDay" class="mono">{{ hm(e.start) }}</span> {{ e.title }}
        </span>
        <span v-if="(byDay.get(key(d)) ?? []).length > 3" class="muted" style="font-size: 11px">+{{ (byDay.get(key(d)) ?? []).length - 3 }}</span>
      </div>
    </div>

    <div v-else class="week-wrap">
      <div class="week" :style="{ gridTemplateRows: `auto auto ${(DAY_END - DAY_START) * HOUR_PX}px` }">
        <span />
        <span v-for="d in days" :key="'h' + key(d)" :class="['week-day', { today: key(d) === today }]">
          <span class="mono">{{ d.toLocaleDateString(dateLocale(), { weekday: 'short' }) }}</span> <strong class="serif">{{ d.getDate() }}</strong>
        </span>
        <span class="mono muted week-allday-label">{{ t('agenda.cal.allDayRow') }}</span>
        <div v-for="d in days" :key="'a' + key(d)" class="week-allday">
          <span v-for="(e, i) in allDay(d)" :key="i" :class="['chip-ev', e.kind]">{{ e.title }}</span>
        </div>
        <div class="week-hours">
          <span v-for="h in DAY_END - DAY_START" :key="h" class="mono" :style="{ height: `${HOUR_PX}px` }">{{ String(DAY_START + h - 1).padStart(2, '0') }}h</span>
        </div>
        <div v-for="d in days" :key="'c' + key(d)" :class="['week-col', { today: key(d) === today }]" :style="{ backgroundSize: `100% ${HOUR_PX}px` }">
          <span v-for="(e, i) in timed(d)" :key="i" :class="['week-ev', e.kind]" :style="place(e)" :title="`${hm(e.start)}–${hm(e.end)} · ${e.title}`">
            <span class="mono">{{ hm(e.start) }}</span>
            <span>{{ e.title }}</span>
          </span>
        </div>
      </div>
    </div>

    <div class="cal-legend">
      <span><i class="agenda" /> {{ t('agenda.cal.legendAgenda') }}</span>
      <span><i class="proposed" /> {{ t('agenda.cal.legendProposed') }}</span>
      <span><i class="conflict" /> {{ t('agenda.cal.legendConflict') }}</span>
    </div>
  </section>
</template>
