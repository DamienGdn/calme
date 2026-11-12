<script setup lang="ts">
import { computed, onActivated, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, post } from '../api.ts';
import AgendaBrief from '../components/AgendaBrief.vue';
import EventSheet, { type OpenEvent } from '../components/EventSheet.vue';
import RemindersPanel from '../components/RemindersPanel.vue';
import Icon from '../components/Icon.vue';
import { dateLocale } from '../i18n.ts';
import { notify, notifyError, openEditor } from '../store.ts';
import CalendarView from './CalendarView.vue';
import NewEvent from './NewEvent.vue';

interface CalInfo {
  id: string;
  name: string;
  color: string;
  primary: boolean;
  writable: boolean;
  hidden?: boolean;
}
interface CalEvent extends OpenEvent {
  calendar?: { id: string; name: string; color: string; primary: boolean };
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
  t1: string;
  t2: string;
  ev: CalEvent;
  kind: 'agenda' | 'proposed' | 'conflict';
}

const { t } = useI18n();
const view = ref<{ connected: boolean; events: CalEvent[]; proposals: Proposal[]; calendars: CalInfo[]; limitedCalendars: boolean } | null>(null);
const busy = ref<string | null>(null);
const form = ref(false);
const formAt = ref<{ day?: string; time?: string }>({});
function openForm(day?: string, time?: string) {
  formAt.value = { day, time };
  form.value = true;
}
const opened = ref<OpenEvent | null>(null);
const mode = ref<'liste' | 'semaine' | 'mois'>('liste');

const load = () => api<typeof view.value>('/api/agenda').then((v) => (view.value = v)).catch(notifyError);

const localDay = (d: Date) => d.toLocaleDateString('sv-SE');
const addDays = (k: string, n: number) => {
  const d = new Date(k + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return localDay(d);
};
const time = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
const longDay = (iso: string) => new Date(iso).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
const todayKey = localDay(new Date());
const calName = (c?: { name: string; primary: boolean }) => (c ? (c.primary ? t('agenda.mine') : c.name) : '');

// Calendars shown: one choice for every device (Admin › Calendars, or the chips here).
const hidden = computed(() => new Set((view.value?.calendars ?? []).filter((c) => c.hidden).map((c) => c.id)));
async function toggleCal(id: string) {
  const next = new Set(hidden.value);
  if (!next.delete(id)) next.add(id);
  try {
    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ hiddenCalendars: [...next] }) });
    reload();
  } catch (e) {
    notifyError(e);
  }
}
const shown = (e: CalEvent) => !e.calendar || !hidden.value.has(e.calendar.id);

// List: every upcoming appointment, by month, loaded two months at a time.
const listEvents = ref<CalEvent[] | null>(null);
const until = ref(addDays(todayKey, 59));
const loadingMore = ref(false);
async function loadList(from: string, to: string, append = false) {
  try {
    const r = await api<{ events: CalEvent[] }>(`/api/agenda/range?from=${from}&to=${to}`);
    listEvents.value = append ? [...(listEvents.value ?? []), ...r.events] : r.events;
  } catch (e) {
    if (!append) listEvents.value = [];
    notifyError(e);
  }
}
async function more() {
  loadingMore.value = true;
  const from = addDays(until.value, 1);
  until.value = addDays(from, 59);
  await loadList(from, until.value, true);
  loadingMore.value = false;
}
const reload = () => {
  void load();
  if (view.value?.connected !== false) void loadList(todayKey, until.value);
};
// Kept alive between tabs (App.vue): the last view stays on screen while it is refreshed.
onActivated(async () => {
  await load();
  if (view.value?.connected) void loadList(todayKey, until.value);
  else listEvents.value = [];
});

async function add(p: Proposal) {
  busy.value = p.mailId;
  try {
    await post(`/api/mail/${encodeURIComponent(p.mailId)}/event`);
    notify(t('agenda.addedToast', { title: p.event.title }));
    reload();
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

const pending = computed(() => (view.value?.proposals ?? []).filter((p) => !p.added));
const conflicts = computed(() => pending.value.filter((p) => p.conflict).length);
const pendingEvents = computed(() => pending.value.map((p) => ({ title: p.event.title, start: p.event.start, end: p.event.end, conflict: Boolean(p.conflict) })));

/** Months → days → appointments, in reading order (all-day first, then by time). */
const months = computed(() => {
  const rows: { day: string; row: Row }[] = [];
  for (const e of listEvents.value ?? []) {
    if (!shown(e)) continue;
    if (e.allDay) rows.push({ day: e.start < todayKey ? todayKey : e.start, row: { t1: t('agenda.allDay'), t2: '', ev: e, kind: 'agenda' } });
    else rows.push({ day: localDay(new Date(e.start)), row: { t1: time(e.start), t2: time(e.end), ev: e, kind: 'agenda' } });
  }
  for (const p of pending.value) {
    const ev: CalEvent = { title: p.event.title, start: p.event.start, end: p.event.end, allDay: false, location: p.event.location, fromMail: t('agenda.fromMail', { from: p.fromName, subject: p.subject }) };
    rows.push({ day: localDay(new Date(p.event.start)), row: { t1: time(p.event.start), t2: time(p.event.end), ev, kind: p.conflict ? 'conflict' : 'proposed' } });
  }
  const byMonth = new Map<string, Map<string, Row[]>>();
  for (const { day, row } of rows) {
    if (day < todayKey || day > until.value) continue;
    const m = byMonth.get(day.slice(0, 7)) ?? new Map<string, Row[]>();
    m.set(day, [...(m.get(day) ?? []), row]);
    byMonth.set(day.slice(0, 7), m);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, days]) => ({
      key,
      label: new Date(key + '-15T12:00:00').toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' }),
      days: [...days.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, list]) => ({ day, rows: list.sort((x, y) => Number(y.ev.allDay) - Number(x.ev.allDay) || x.ev.start.localeCompare(y.ev.start)) })),
    }));
});
const writable = computed(() => (view.value?.calendars ?? []).filter((c) => c.writable));
const canDelete = (e: OpenEvent) => Boolean(e.id && e.calendar?.id && writable.value.some((c) => c.id === e.calendar!.id));
const deleting = ref(false);
/** Appointment being edited in the form (null for a new one). */
const editing = ref<OpenEvent | null>(null);
function editOpened() {
  editing.value = opened.value;
  opened.value = null;
  form.value = true;
}
async function removeOpened() {
  const e = opened.value;
  if (!e?.id || !e.calendar?.id) return;
  deleting.value = true;
  try {
    await api(`/api/agenda/events/${encodeURIComponent(e.calendar.id)}/${encodeURIComponent(e.id)}`, { method: 'DELETE' });
    notify(t('agenda.deleted', { title: e.title }));
    opened.value = null;
    listEvents.value = (listEvents.value ?? []).filter((x) => x.id !== e.id);
    reload();
  } catch (err) {
    notifyError(err);
  } finally {
    deleting.value = false;
  }
}
watch(mode, (m) => m === 'liste' && listEvents.value === null && void loadList(todayKey, until.value));
</script>

<template>
  <header class="topbar">
    <span class="eyebrow">{{ t('agenda.eyebrow') }}</span>
    <button type="button" class="btn btn-prim wide-only" :aria-label="t('agenda.newEvent')" @click="openForm()"><Icon name="calendar" :size="16" /> {{ t('agenda.newEvent') }}</button>
  </header>

  <h1 class="headline" style="max-width: 18ch">
    <template v-if="pending.length">
      <span class="hot">{{ t('agenda.headlineFound', pending.length) }}</span> {{ t('agenda.headlineIn') }}
      <em>{{ conflicts === 0 ? t('agenda.noConflict') : conflicts === 1 ? t('agenda.oneConflict') : t('agenda.conflicts', { n: conflicts }) }}</em>
    </template>
    <template v-else>{{ t('agenda.ahead') }} <em>{{ t('agenda.aheadEm') }}</em></template>
  </h1>

  <div v-if="view && !view.connected" class="banner">
    <p>{{ t('agenda.notConnected') }}</p>
    <a class="btn btn-prim" href="/auth/google" target="_blank" rel="opener">{{ t('agenda.connect') }}</a>
  </div>
  <div v-else-if="view?.limitedCalendars" class="banner">
    <p>{{ t('agenda.limited') }}</p>
    <a class="btn" href="/auth/google" target="_blank" rel="opener">{{ t('agenda.reconnect') }}</a>
  </div>

  <AgendaBrief />
  <RemindersPanel compact />

  <NewEvent v-if="form" :day="formAt.day" :time="formAt.time" :event="editing ?? undefined" :calendars="writable" @close="form = false; editing = null" @done="form = false; editing = null; reload()" />
  <EventSheet v-if="opened" :event="opened" :can-delete="canDelete(opened)" :busy="deleting" @close="opened = null" @delete="removeOpened" @edit="editOpened" />

  <div class="agenda-tools">
    <div class="tones" role="radiogroup" :aria-label="t('agenda.view')">
      <button v-for="m in (['liste', 'semaine', 'mois'] as const)" :key="m" type="button" role="radio" :aria-checked="mode === m" style="min-height: 40px" @click="mode = m">
        {{ t(`agenda.views.${m}`) }}
      </button>
    </div>
    <div v-if="(view?.calendars.length ?? 0) > 1" class="cal-chips" role="group" :aria-label="t('agenda.calendars')">
      <button v-for="c in view?.calendars ?? []" :key="c.id" type="button" class="cal-chip" :aria-pressed="!hidden.has(c.id)" @click="toggleCal(c.id)">
        <i :style="{ background: c.color }" aria-hidden="true" /> {{ c.primary ? t('agenda.mine') : c.name }}
      </button>
    </div>
  </div>

  <CalendarView v-if="mode !== 'liste'" :key="mode" :mode="mode" :pending="pendingEvents" :hidden="[...hidden]" @open="(e) => (opened = e)" @create="openForm" />

  <template v-else>
    <section v-if="view?.proposals.length" aria-labelledby="found" class="found">
      <h2 id="found" class="eyebrow" style="margin: 0; font-weight: 500">{{ t('agenda.found') }}</h2>
        <article v-for="(p, i) in view?.proposals ?? []" :key="p.mailId" class="proposal rise" :style="{ animationDelay: `${i * 60}ms`, borderColor: p.conflict ? 'var(--hot)' : undefined }">
          <span class="eyebrow" style="display: flex; align-items: center; gap: 8px">
            <span aria-hidden="true" :style="{ width: '8px', height: '8px', borderRadius: '2px', background: p.conflict ? 'var(--hot)' : 'var(--accent)' }" />
            {{ longDay(p.event.start) }} · {{ time(p.event.start) }}–{{ time(p.event.end) }}
          </span>
          <span class="serif" style="font-size: 21px; line-height: 1.05">{{ p.event.title }}</span>
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
    </section>

    <section class="months" :aria-label="t('agenda.yourAgenda')">
      <p v-if="listEvents === null" class="empty">{{ t('common.loading') }}</p>
      <div v-for="m in months" :key="m.key" class="month-block">
        <h2 class="month-title">{{ m.label }}</h2>
        <div class="timeline carnet">
          <div v-for="d in m.days" :key="d.day" :class="['tl-day', { today: d.day === todayKey }]">
            <div class="tl-date">
              <span class="tl-n">{{ new Date(d.day + 'T12:00:00').getDate() }}</span>
              <span class="tl-wd">{{ d.day === todayKey ? t('common.today') : new Date(d.day + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long' }) }}</span>
            </div>
            <div class="tl-evs">
              <button
                v-for="(r, j) in d.rows"
                :key="j"
                type="button"
                :class="['tl-ev', r.kind, { prop: r.kind !== 'agenda', conflict: r.kind === 'conflict' }]"
                :style="r.ev.calendar ? { '--cal': r.ev.calendar.color } : undefined"
                @click="opened = r.ev"
              >
                <span class="mono muted tl-time"><span>{{ r.t1 }}</span><span v-if="r.t2" class="tl-t2">{{ r.t2 }}</span></span>
                <span class="tl-main">
                  <span class="tl-title">{{ r.ev.title }}</span>
                  <span class="tl-cal">
                    <template v-if="r.kind === 'agenda'"><i :style="{ background: r.ev.calendar?.color }" aria-hidden="true" /> {{ calName(r.ev.calendar) }}</template>
                    <template v-else>{{ t('agenda.tagProposed') }}</template>
                    <template v-if="r.ev.location"> · {{ r.ev.location }}</template>
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <p v-if="listEvents !== null && !months.length" class="empty">{{ t('agenda.nothingPlanned') }}</p>
      <button v-if="view?.connected" type="button" class="btn" style="align-self: flex-start" :disabled="loadingMore" @click="more">{{ loadingMore ? t('common.loading') : t('agenda.more') }}</button>
    </section>
  </template>
  <button v-if="!form && !opened" type="button" class="fab fab-round" :aria-label="t('agenda.newEvent')" @click="openForm()"><Icon name="plus" :size="24" /></button>
</template>
