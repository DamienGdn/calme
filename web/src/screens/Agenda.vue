<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, post } from '../api.ts';
import Icon from '../components/Icon.vue';
import { dateLocale } from '../i18n.ts';
import { notify, notifyError, openEditor } from '../store.ts';
import CalendarView from './CalendarView.vue';
import NewEvent from './NewEvent.vue';

interface CalEvent {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
}
interface Proposal {
  mailId: string;
  fromName: string;
  subject: string;
  event: { title: string; start: string; end: string; location: string | null };
  conflict: string | null;
  added: string | null;
}
interface Row {
  time: string;
  title: string;
  tag: 'agenda' | 'proposed';
  conflict: boolean;
}

const { t } = useI18n();
const view = ref<{ connected: boolean; events: CalEvent[]; proposals: Proposal[] } | null>(null);
const busy = ref<string | null>(null);
const day = ref<string | null>(null);
const form = ref(false);
const mode = ref<'liste' | 'semaine' | 'mois'>('liste');

const load = () => api<typeof view.value>('/api/agenda').then((v) => (view.value = v)).catch(notifyError);
onMounted(load);

const localDay = (d: Date) => d.toLocaleDateString('sv-SE');
const time = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
const longDay = (iso: string) => new Date(iso).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
const fullDay = (k: string) => new Date(k + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' });

async function add(p: Proposal) {
  busy.value = p.mailId;
  try {
    await post(`/api/mail/${encodeURIComponent(p.mailId)}/event`);
    notify(t('agenda.addedToast', { title: p.event.title }));
    await load();
  } catch (e) {
    notifyError(e);
  } finally {
    busy.value = null;
  }
}
async function dismiss(p: Proposal) {
  await post(`/api/agenda/dismiss/${encodeURIComponent(p.mailId)}`).catch(() => {});
  await load();
}

const today = new Date();
const days = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(today);
  d.setDate(today.getDate() + i);
  return d;
});
const rowsByDay = computed(() => {
  const map = new Map<string, Row[]>();
  const push = (k: string, r: Row) => map.set(k, [...(map.get(k) ?? []), r]);
  for (const e of view.value?.events ?? []) {
    if (e.allDay) push(e.start, { time: t('agenda.allDay'), title: e.title, tag: 'agenda', conflict: false });
    else push(localDay(new Date(e.start)), { time: `${time(e.start)}–${time(e.end)}`, title: e.title, tag: 'agenda', conflict: false });
  }
  for (const p of view.value?.proposals ?? [])
    if (!p.added) push(localDay(new Date(p.event.start)), { time: `${time(p.event.start)}–${time(p.event.end)}`, title: p.event.title, tag: 'proposed', conflict: Boolean(p.conflict) });
  return map;
});
const pending = computed(() => (view.value?.proposals ?? []).filter((p) => !p.added));
const conflicts = computed(() => pending.value.filter((p) => p.conflict).length);
const visibleDays = computed(() => days.map(localDay).filter((k) => (rowsByDay.value.get(k)?.length ?? 0) > 0 && (!day.value || day.value === k)));
const pendingEvents = computed(() => pending.value.map((p) => ({ title: p.event.title, start: p.event.start, end: p.event.end, conflict: Boolean(p.conflict) })));
const dotColor = (r: Row) => (r.tag === 'agenda' ? 'var(--muted)' : r.conflict ? 'var(--hot)' : 'var(--accent)');
</script>

<template>
  <header class="topbar">
    <span class="eyebrow">{{ t('agenda.eyebrow') }}</span>
    <button type="button" class="btn btn-prim" :aria-expanded="form" @click="form = !form"><Icon name="calendar" :size="16" /> {{ t('agenda.newEvent') }}</button>
    <a class="btn" href="https://calendar.google.com" target="_blank" rel="noopener noreferrer">{{ t('agenda.openGoogle') }}</a>
  </header>

  <h1 class="headline" style="max-width: 18ch">
    <template v-if="pending.length">
      <span class="hot">{{ t('agenda.headlineFound', pending.length) }}</span> {{ t('agenda.headlineIn') }}
      <em>{{ conflicts === 0 ? t('agenda.noConflict') : conflicts === 1 ? t('agenda.oneConflict') : t('agenda.conflicts', { n: conflicts }) }}</em>
    </template>
    <template v-else>{{ t('agenda.fortnight') }} <em>{{ t('agenda.fortnightEm') }}</em></template>
  </h1>

  <div v-if="view && !view.connected" class="banner">
    <p>{{ t('agenda.notConnected') }}</p>
    <a class="btn btn-prim" href="/auth/google" target="_blank" rel="opener">{{ t('agenda.connect') }}</a>
  </div>

  <NewEvent v-if="form" @done="form = false; load()" />

  <div class="tones" role="radiogroup" :aria-label="t('agenda.view')" style="align-self: flex-start">
    <button v-for="m in (['liste', 'semaine', 'mois'] as const)" :key="m" type="button" role="radio" :aria-checked="mode === m" style="min-height: 40px" @click="mode = m">
      {{ t(`agenda.views.${m}`) }}
    </button>
  </div>

  <CalendarView v-if="mode !== 'liste'" :key="mode" :mode="mode" :pending="pendingEvents" />

  <template v-else>
    <div class="strip" role="list" :aria-label="t('agenda.next14')">
      <button
        v-for="(d, i) in days"
        :key="localDay(d)"
        type="button"
        role="listitem"
        :class="['strip-day', { today: i === 0 }]"
        :aria-pressed="day === localDay(d)"
        :aria-label="`${fullDay(localDay(d))} : ${t('agenda.items', rowsByDay.get(localDay(d))?.length ?? 0)}`"
        @click="day = day === localDay(d) ? null : localDay(d)"
      >
        <span class="mono wd">{{ d.toLocaleDateString(dateLocale(), { weekday: 'short' }) }}</span>
        <span class="serif n">{{ d.getDate() }}</span>
        <span class="dots" aria-hidden="true">
          <i v-for="(r, j) in (rowsByDay.get(localDay(d)) ?? []).slice(0, 3)" :key="j" :style="{ background: dotColor(r) }" />
        </span>
      </button>
    </div>

    <div style="display: flex; flex-wrap: wrap; gap: 28px; align-items: flex-start">
      <section aria-labelledby="found" style="flex: 1 1 360px; min-width: 0; display: flex; flex-direction: column; gap: 12px">
        <h2 id="found" class="eyebrow" style="margin: 0; font-weight: 500">{{ t('agenda.found') }}</h2>
        <article v-for="(p, i) in view?.proposals ?? []" :key="p.mailId" class="proposal rise" :style="{ animationDelay: `${i * 60}ms`, borderColor: p.conflict ? 'var(--hot)' : undefined }">
          <span class="eyebrow" style="display: flex; align-items: center; gap: 8px">
            <span aria-hidden="true" :style="{ width: '8px', height: '8px', borderRadius: '2px', background: p.conflict ? 'var(--hot)' : 'var(--accent)' }" />
            {{ longDay(p.event.start) }} · {{ time(p.event.start) }}–{{ time(p.event.end) }}
          </span>
          <span class="serif" style="font-size: 26px; line-height: 1.05">{{ p.event.title }}</span>
          <span v-if="p.event.location" class="muted" style="font-size: 13px">{{ p.event.location }}</span>
          <span style="font-size: 13px; color: var(--body)">{{ t('agenda.fromMail', { from: p.fromName, subject: p.subject }) }}</span>
          <span v-if="p.conflict" class="warn">{{ t('agenda.overlaps', { title: p.conflict }) }}</span>
          <span style="display: flex; flex-wrap: wrap; gap: 8px">
            <a v-if="p.added" class="btn" :href="p.added" target="_blank" rel="noopener noreferrer" style="color: var(--accent-text); font-weight: 600">{{ t('agenda.added') }}</a>
            <template v-else>
              <button type="button" class="btn btn-prim" :disabled="busy === p.mailId" @click="add(p)">{{ t('agenda.add') }}</button>
              <button type="button" class="btn" @click="openEditor({ mailId: p.mailId, slots: Boolean(p.conflict) })">{{ p.conflict ? t('agenda.otherSlot') : t('agenda.reply') }}</button>
              <button type="button" class="btn" style="border: 0; color: var(--muted)" @click="dismiss(p)">{{ t('agenda.ignore') }}</button>
            </template>
          </span>
        </article>
        <p v-if="view && !view.proposals.length" class="empty" style="padding: 12px 0">{{ t('agenda.nothingNew') }}</p>
      </section>

      <section aria-labelledby="days" style="flex: 2 1 520px; min-width: 0; display: flex; flex-direction: column; gap: 12px">
        <h2 id="days" class="eyebrow" style="margin: 0; font-weight: 500">{{ t('agenda.yourAgenda') }}{{ day ? ` · ${fullDay(day)}` : '' }}</h2>
        <div class="timeline">
          <div v-for="k in visibleDays" :key="k" class="tl-day">
            <div style="display: flex; flex-direction: column; gap: 2px">
              <span class="serif" style="font-size: 26px; line-height: 1; text-transform: capitalize">
                {{ k === localDay(today) ? t('common.today') : new Date(k + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long' }) }} {{ new Date(k + 'T12:00:00').getDate() }}
              </span>
              <span class="eyebrow" style="padding: 0">{{ new Date(k + 'T12:00:00').toLocaleDateString(dateLocale(), { month: 'long' }) }}</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px">
              <div v-for="(r, j) in rowsByDay.get(k)" :key="j" :class="['tl-ev', { prop: r.tag !== 'agenda', conflict: r.conflict }]">
                <span class="mono muted" style="font-size: 13px">{{ r.time }}</span>
                <span style="font-size: 15px">{{ r.title }}</span>
                <span class="mono tag">{{ r.tag === 'agenda' ? t('agenda.tagAgenda') : t('agenda.tagProposed') }}</span>
              </div>
            </div>
          </div>
          <p v-if="view && !visibleDays.length" class="empty">{{ t('agenda.nothingPlanned') }}</p>
          <p v-if="!view" class="empty">{{ t('common.loading') }}</p>
        </div>
        <p class="muted" style="margin: 0; display: flex; align-items: center; gap: 8px; font-size: 13px"><span class="dot" aria-hidden="true" /> {{ t('agenda.calmeUses') }}</p>
      </section>
    </div>
  </template>
</template>
