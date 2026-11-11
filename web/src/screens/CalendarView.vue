<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api.ts';
import Icon from '../components/Icon.vue';
import { dateLocale } from '../i18n.ts';
import { notifyError } from '../store.ts';
import { useMedia } from '../tabs.ts';
import { axis } from '../gestures.ts';

interface CalEvent {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string | null;
  description?: string | null;
  link?: string | null;
  calendar?: { id: string; name: string; color: string; primary: boolean };
}
export interface PendingEvent {
  title: string;
  start: string;
  end: string;
  conflict: boolean;
}
type Item = CalEvent & { kind: 'agenda' | 'proposed' | 'conflict' };

/**
 * Week (hour grid) and month (6×7 grid) views over Google Calendar plus events proposed by mails.
 * On the phone the week reads as a diary (one page per day) and the month as a dotted grid: tap a day to read it.
 */
const props = defineProps<{ mode: 'semaine' | 'mois'; pending: PendingEvent[]; hidden?: string[] }>();
const emit = defineEmits<{ open: [e: CalEvent & { fromMail?: string }]; create: [day: string, time?: string] }>();
/** Week grid: a click on an empty spot creates an appointment at that hour. */
function slotClick(ev: MouseEvent, d: Date) {
  if (ev.target !== ev.currentTarget) return;
  const h = DAY_START + Math.floor((ev.offsetY ?? 0) / HOUR_PX);
  emit('create', key(d), `${String(Math.min(h, 23)).padStart(2, '0')}:00`);
}
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

/** Direction of the last move, for the slide-in of the new week or month. */
const slide = ref<'next' | 'prev' | null>(null);
const slideKey = ref(0);
function shift(dir: number) {
  anchor.value = props.mode === 'semaine' ? addDays(anchor.value, 7 * dir) : new Date(anchor.value.getFullYear(), anchor.value.getMonth() + dir, 1);
  slide.value = dir > 0 ? 'next' : 'prev';
  slideKey.value++;
}

// Sideways scroll (trackpad, mouse) moves to the previous / next week or month; one step per gesture.
const wrapEl = ref<HTMLElement | null>(null);
let wheelSum = 0;
let wheelQuietUntil = 0;
let wheelReset = 0;
function onWheel(e: WheelEvent) {
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
  const wrap = wrapEl.value;
  if (wrap && wrap.scrollWidth > wrap.clientWidth + 1) return; // the grid scrolls sideways itself on narrow windows
  e.preventDefault();
  window.clearTimeout(wheelReset);
  wheelReset = window.setTimeout(() => (wheelSum = 0), 200);
  if (Date.now() < wheelQuietUntil) return;
  wheelSum += e.deltaX;
  if (Math.abs(wheelSum) < 60) return;
  shift(wheelSum > 0 ? 1 : -1);
  wheelSum = 0;
  wheelQuietUntil = Date.now() + 600;
}

// Phone: a sideways swipe does the same.
let touch: { x: number; y: number } | null = null;
let touchAxis: 'x' | 'y' | null = null;
function touchDown(e: PointerEvent) {
  if (e.pointerType !== 'touch') return;
  touch = { x: e.clientX, y: e.clientY };
  touchAxis = null;
}
function touchMove(e: PointerEvent) {
  if (!touch) return;
  touchAxis ??= axis(e.clientX - touch.x, e.clientY - touch.y);
  if (touchAxis === 'y') touch = null;
}
function touchUp(e: PointerEvent) {
  if (touch && touchAxis === 'x' && Math.abs(e.clientX - touch.x) > 60) shift(e.clientX < touch.x ? 1 : -1);
  touch = null;
}

// Week grid: a ghost "+ 14:00" slot follows the pointer over free time.
const ghost = ref<{ day: string; hour: number } | null>(null);
function slotMove(ev: MouseEvent, d: Date) {
  if (ev.target !== ev.currentTarget) {
    ghost.value = null;
    return;
  }
  const hour = Math.min(DAY_END - 1, DAY_START + Math.floor(ev.offsetY / HOUR_PX));
  if (ghost.value?.day !== key(d) || ghost.value.hour !== hour) ghost.value = { day: key(d), hour };
}
const title = computed(() =>
  props.mode === 'semaine'
    ? t('agenda.cal.weekOf', { date: days.value[0].toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long' }) })
    : anchor.value.toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' }),
);
const weekdays = computed(() => days.value.slice(0, 7).map((d) => d.toLocaleDateString(dateLocale(), { weekday: 'short' })));

const byDay = computed(() => {
  const items: Item[] = [
    ...(events.value ?? []).filter((e) => !e.calendar || !props.hidden?.includes(e.calendar.id)).map((e) => ({ ...e, kind: 'agenda' as const })),
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
const phone = useMedia('(max-width: 720px)');
/** Day shown under the month grid on the phone: today when it is in view, else the 1st. */
const sel = ref(today);
watch(first, () => {
  const inView = days.value.some((d) => key(d) === today && d.getMonth() === anchor.value.getMonth());
  sel.value = inView ? today : key(new Date(anchor.value.getFullYear(), anchor.value.getMonth(), 1));
}, { immediate: true });
/** A day's events in reading order: all-day first, then by start time. */
const dayItems = (k: string) =>
  [...(byDay.value.get(k) ?? [])].sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
const fromKey = (k: string) => new Date(k + 'T12:00:00');
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
  <section class="cal" :aria-label="title" @wheel="onWheel" @pointerdown="touchDown" @pointermove="touchMove" @pointerup="touchUp" @pointercancel="touch = null">
    <div class="cal-head">
      <button type="button" class="btn btn-icon" :aria-label="mode === 'semaine' ? t('agenda.cal.prevWeek') : t('agenda.cal.prevMonth')" @click="shift(-1)"><Icon name="back" :size="16" /></button>
      <button type="button" class="btn" @click="anchor = new Date()">{{ t('common.today') }}</button>
      <button type="button" class="btn btn-icon" style="transform: scaleX(-1)" :aria-label="mode === 'semaine' ? t('agenda.cal.nextWeek') : t('agenda.cal.nextMonth')" @click="shift(1)">
        <Icon name="back" :size="16" />
      </button>
      <h2 class="serif cal-title">{{ title }}</h2>
      <span v-if="!events" class="muted" style="font-size: 13px">{{ t('common.loading') }}</span>
    </div>

    <div v-if="mode === 'mois'" :key="'m' + slideKey" :class="['month', slide && `slide-${slide}`]">
      <span v-for="w in weekdays" :key="w" class="month-wd mono">{{ w }}</span>
      <button
        v-for="d in days"
        :key="key(d)"
        type="button"
        :class="['month-cell', { out: d.getMonth() !== anchor.getMonth(), today: key(d) === today, sel: phone && sel === key(d) }]"
        :aria-pressed="phone ? sel === key(d) : undefined"
        @click="sel = key(d)"
        @dblclick="emit('create', key(d))"
      >
        <span v-if="!phone" class="cell-add" role="button" tabindex="0" :aria-label="t('agenda.addOn', { date: d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long' }) })" @click.stop="emit('create', key(d))" @keydown.enter.stop="emit('create', key(d))">+</span>
        <span class="month-n">{{ d.getDate() }}</span>
        <span class="month-dots" aria-hidden="true"><i v-for="(e, i) in (byDay.get(key(d)) ?? []).slice(0, 3)" :key="i" :class="e.kind" :style="e.kind === 'agenda' && e.calendar ? { background: e.calendar.color } : undefined" /></span>
        <span
          v-for="(e, i) in (byDay.get(key(d)) ?? []).slice(0, 3)"
          :key="i"
          :class="['chip-ev', e.kind]"
          :style="e.calendar ? { '--cal': e.calendar.color } : undefined"
          @click.stop="emit('open', e)"
          :title="`${e.allDay ? t('agenda.allDay') : `${hm(e.start)}–${hm(e.end)}`} · ${e.title}`"
        >
          <span v-if="!e.allDay" class="mono">{{ hm(e.start) }}</span> {{ e.title }}
        </span>
        <span v-if="(byDay.get(key(d)) ?? []).length > 3" class="muted more" style="font-size: 11px">+{{ (byDay.get(key(d)) ?? []).length - 3 }}</span>
      </button>
    </div>

    <!-- Phone: the diary. Month: the day tapped in the grid. Week: one page per day. -->
    <div v-if="phone" :key="'c' + slideKey" :class="['timeline carnet', mode === 'semaine' && slide && `slide-${slide}`]">
      <div v-for="k in mode === 'mois' ? [sel] : days.map(key)" :key="k" :class="['tl-day', { today: k === today }]">
        <div class="tl-date">
          <span class="tl-n">{{ fromKey(k).getDate() }}</span>
          <span class="tl-wd">{{ k === today ? t('common.today') : fromKey(k).toLocaleDateString(dateLocale(), { weekday: 'long' }) }}</span>
          <span class="eyebrow" style="padding: 0">{{ fromKey(k).toLocaleDateString(dateLocale(), { month: 'long' }) }}</span>
        </div>
        <div class="tl-evs">
          <button
            v-for="(e, i) in dayItems(k)"
            :key="i"
            type="button"
            :class="['tl-ev', e.kind, { prop: e.kind !== 'agenda', conflict: e.kind === 'conflict' }]"
            :style="e.calendar ? { '--cal': e.calendar.color } : undefined"
            @click="emit('open', e)"
          >
            <span class="mono muted tl-time"><span>{{ e.allDay ? t('agenda.allDay') : hm(e.start) }}</span><span v-if="!e.allDay" class="tl-t2">{{ hm(e.end) }}</span></span>
            <span class="tl-main">
              <span class="tl-title">{{ e.title }}</span>
              <span class="tl-cal">{{ e.kind === 'agenda' ? (e.calendar ? (e.calendar.primary ? t('agenda.mine') : e.calendar.name) : t('agenda.tagAgenda')) : t('agenda.tagProposed') }}</span>
            </span>
          </button>
          <p v-if="!dayItems(k).length" class="tl-free">{{ t('agenda.cal.free') }}</p>
          <button type="button" class="tl-add" @click="emit('create', k)">+ {{ t('agenda.addOn', { date: fromKey(k).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric' }) }) }}</button>
        </div>
      </div>
    </div>

    <div v-else-if="mode === 'semaine'" ref="wrapEl" :key="'w' + slideKey" :class="['week-wrap', slide && `slide-${slide}`]">
      <div class="week" :style="{ gridTemplateRows: `auto auto ${(DAY_END - DAY_START) * HOUR_PX}px` }">
        <span />
        <span v-for="d in days" :key="'h' + key(d)" :class="['week-day', { today: key(d) === today }]">
          <span class="mono">{{ d.toLocaleDateString(dateLocale(), { weekday: 'short' }) }}</span> <strong class="serif">{{ d.getDate() }}</strong>
        </span>
        <span class="mono muted week-allday-label">{{ t('agenda.cal.allDayRow') }}</span>
        <div v-for="d in days" :key="'a' + key(d)" class="week-allday">
          <span v-for="(e, i) in allDay(d)" :key="i" :class="['chip-ev', e.kind]" :style="e.calendar ? { '--cal': e.calendar.color } : undefined" @click="emit('open', e)">{{ e.title }}</span>
        </div>
        <div class="week-hours">
          <span v-for="h in DAY_END - DAY_START" :key="h" class="mono" :style="{ height: `${HOUR_PX}px` }">{{ String(DAY_START + h - 1).padStart(2, '0') }}h</span>
        </div>
        <div
          v-for="d in days"
          :key="'c' + key(d)"
          :class="['week-col', { today: key(d) === today }]"
          :style="{ backgroundSize: `100% ${HOUR_PX}px` }"
          @click="slotClick($event, d)"
          @mousemove="slotMove($event, d)"
          @mouseleave="ghost = null"
        >
          <span v-if="ghost && ghost.day === key(d)" class="slot-ghost" aria-hidden="true" :style="{ top: `${(ghost.hour - DAY_START) * HOUR_PX + 1}px`, height: `${HOUR_PX - 2}px` }">
            + {{ String(ghost.hour).padStart(2, '0') }}:00
          </span>
          <span v-for="(e, i) in timed(d)" :key="i" :class="['week-ev', e.kind]" :style="{ ...place(e), ...(e.calendar ? { '--cal': e.calendar.color } : {}) }" @click="emit('open', e)" :title="`${hm(e.start)}–${hm(e.end)} · ${e.title}`">
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
