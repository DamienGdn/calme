<script setup lang="ts">
import { computed, onActivated, onDeactivated, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, fullDate, post, useMailBody, when } from '../api.ts';
import EventSheet, { type OpenEvent } from '../components/EventSheet.vue';
import Icon from '../components/Icon.vue';
import MailBody from '../components/MailBody.vue';
import { richText } from '../format.ts';
import { dateLocale } from '../i18n.ts';
import { goTo, notifyError } from '../store.ts';
import { useMedia } from '../tabs.ts';

interface Result {
  id: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  date: number;
  relevant?: boolean;
  source: 'inbox' | 'local' | 'gmail';
}
interface SearchResponse {
  query: string;
  explanation: string;
  /** One short sentence that answers directly (may hold **bold**). */
  lead?: string;
  /** The detail, by theme: a title and short points (may hold **bold**). */
  sections?: { title: string; points: string[] }[];
  /** Short timeline "date — fact" when several mails matter. */
  points?: string[];
  results: Result[];
  /** Appointments of the agenda (a year back and ahead) that match. */
  events?: OpenEvent[];
}

const props = defineProps<{ initial: string }>();
const { t, tm } = useI18n();
const question = ref(props.initial);
const res = ref<SearchResponse | null>(null);
const busy = ref(false);
const open = ref<Result | null>(null);
const openedEvent = ref<OpenEvent | null>(null);
const evWhen = (e: OpenEvent) =>
  e.allDay
    ? new Date(e.start + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : new Date(e.start).toLocaleString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const upcoming = (e: OpenEvent) => Date.parse(e.allDay ? e.start + 'T23:59:59' : e.end) >= Date.now();
const body = useMailBody(
  toRef(() => open.value?.id),
  toRef(() => (open.value?.source === 'local' ? 'archive' : open.value?.source === 'inbox' ? 'inbox' : 'gmail')),
);
const examples = computed(() => tm('search.examples') as unknown as string[]);
/** "3 nov. — Permis accordé" → date and fact, so the timeline can line the dates up. */
const point = (p: string) => {
  const m = /^(.{2,24}?)\s+[—–-]\s+(.+)$/.exec(p);
  return m ? { date: m[1], text: m[2] } : { date: '', text: p };
};
/** Each themed section folds as a whole (the first one open); nothing is cut in the middle of a sentence. */
const lead = computed(() => (res.value?.lead ? richText(res.value.lead)[0] ?? [] : []));
const inline = (s: string) => richText(s)[0] ?? [];
const openSections = ref<Set<number>>(new Set([0]));
watch(res, () => (openSections.value = new Set([0])));
const allOpen = computed(() => (res.value?.sections?.length ?? 0) > 0 && openSections.value.size === res.value!.sections!.length);
function toggleAll() {
  openSections.value = allOpen.value ? new Set() : new Set((res.value?.sections ?? []).map((_, i) => i));
}
function onToggle(i: number, e: Event) {
  const next = new Set(openSections.value);
  if ((e.target as HTMLDetailsElement).open) next.add(i);
  else next.delete(i);
  openSections.value = next;
}
function read(r: Result) {
  if (phone.value && !open.value) history.pushState({ calmReading: true }, '');
  open.value = r;
  if (window.matchMedia('(max-width: 720px)').matches) window.scrollTo({ top: 0 });
}

/** Searches already done this session: coming back to one shows it at once instead of asking Claude again. */
const done = (globalThis as { __calmSearches?: Map<string, SearchResponse> }).__calmSearches ??= new Map();

async function run(q: string, again = false) {
  if (!q.trim()) return;
  const known = again ? undefined : done.get(q);
  if (known) {
    res.value = known;
    return;
  }
  busy.value = true;
  res.value = null;
  open.value = null;
  try {
    res.value = await post<SearchResponse>('/api/search', { question: q });
    done.set(q, res.value);
  } catch (e) {
    notifyError(e);
  } finally {
    busy.value = false;
  }
}
watch(
  () => props.initial,
  (q) => {
    question.value = q;
    if (q) void run(q);
  },
  { immediate: true },
);
/** Extended search: Claude over all of Gmail and the agenda (the question goes in the address, like before). */
function extend() {
  const q = question.value.trim();
  if (!q) return;
  if (q === props.initial) void run(q, true);
  else goTo('recherche', q);
}

// Quick search as you type: inbox and local base, contents included, instant. Return closes the phone keyboard.
const quick = ref<Result[] | null>(null);
let quickTimer = 0;
let quickSeq = 0;
watch(question, (q) => {
  window.clearTimeout(quickTimer);
  const s = q.trim();
  if (!s) {
    quick.value = null;
    return;
  }
  quickTimer = window.setTimeout(async () => {
    const seq = ++quickSeq;
    try {
      const r = await api<Result[]>(`/api/search/quick?q=${encodeURIComponent(s)}`);
      if (seq === quickSeq) quick.value = r;
    } catch (e) {
      notifyError(e);
    }
  }, 220);
});
/** The quick list shows while the field holds something other than the question Calm answered. */
const showQuick = computed(() => Boolean(question.value.trim()) && !(res.value && question.value.trim() === props.initial) && !busy.value);
const listed = computed(() => (showQuick.value ? (quick.value ?? []) : (res.value?.results ?? [])));
const sourceLabel = (r: Result) => (r.source === 'inbox' ? t('search.inbox') : r.source === 'local' ? t('search.local') : t('search.gmail'));
function submit() {
  (document.activeElement as HTMLElement | null)?.blur();
}

// Opening a mail adds a history step on the phone: the back gesture returns to the results, not out of the search.
const phone = useMedia('(max-width: 720px)');
function closeMail() {
  if (history.state?.calmReading) history.back();
  else open.value = null;
}
const onPop = () => {
  if (!history.state?.calmReading) open.value = null;
};
// Kept alive between tabs (App.vue): the back gesture is listened to only while the screen shows.
onActivated(() => window.addEventListener('popstate', onPop));
onDeactivated(() => window.removeEventListener('popstate', onPop));
</script>

<template>
  <header class="topbar"><span class="eyebrow">{{ t('search.eyebrow') }}</span></header>

  <template v-if="!(phone && open)">
  <form class="ask-big" role="search" @submit.prevent="submit">
    <span class="dot" aria-hidden="true" />
    <label class="sr" for="q">{{ t('search.label') }}</label>
    <input id="q" v-model="question" :placeholder="t('search.quickPlaceholder')" type="search" enterkeyhint="search" />
    <button type="button" class="btn btn-prim" :disabled="busy || !question.trim()" :title="t('search.extendHint')" @click="extend">{{ busy ? t('search.busy') : t('search.extend') }}</button>
  </form>

  <div v-if="!question.trim() && !res && !busy" style="display: flex; flex-direction: column; gap: 10px">
    <span class="eyebrow">{{ t('search.askCalm') }}</span>
    <div style="display: flex; flex-wrap: wrap; gap: 8px">
      <button v-for="x in examples" :key="x" type="button" class="folder" @click="goTo('recherche', x)">{{ x }}</button>
    </div>
  </div>
  <p v-if="showQuick && quick && !quick.length" class="empty">{{ t('search.noQuick') }}</p>

  <p v-if="busy" class="empty">{{ t('search.busyLong') }}</p>
  </template>

  <template v-if="res && !showQuick">
    <section v-if="!(phone && open)" class="claude-box" :aria-label="t('search.answer')">
      <span class="eyebrow" style="display: flex; align-items: center; gap: 8px"><span class="dot" /> {{ t('search.answer') }}</span>
      <p v-if="lead.length" class="answer-lead">
        <template v-for="(s, i) in lead" :key="i"><strong v-if="s.bold">{{ s.text }}</strong><template v-else>{{ s.text }}</template></template>
      </p>
      <div v-if="res.sections?.length" class="answer-sections">
        <button v-if="res.sections.length > 1" type="button" class="linkish fold" @click="toggleAll">{{ allOpen ? t('search.foldAll') : t('search.openAll') }}</button>
        <details v-for="(sec, i) in res.sections" :key="i" class="answer-sec" :open="openSections.has(i)" @toggle="onToggle(i, $event)">
          <summary><span>{{ sec.title }}</span><span class="mono muted">{{ sec.points.length }}</span></summary>
          <ul>
            <li v-for="(p, j) in sec.points" :key="j">
              <template v-for="(s, k) in inline(p)" :key="k"><strong v-if="s.bold">{{ s.text }}</strong><template v-else>{{ s.text }}</template></template>
            </li>
          </ul>
        </details>
      </div>
      <details v-if="res.points?.length" class="points-box">
        <summary>{{ t('search.timeline', { n: res.points.length }) }}</summary>
        <ol class="points">
          <li v-for="(p, i) in res.points" :key="i"><span class="mono">{{ point(p).date }}</span><span>{{ point(p).text }}</span></li>
        </ol>
      </details>
      <span class="mono muted" style="font-size: 12px">{{ t('search.query', { q: res.query, n: t('common.mails', res.results.length) }) }}</span>
    </section>

    <section v-if="res.events?.length && !(phone && open)" class="search-events" :aria-label="t('search.events')">
      <h2 class="eyebrow" style="margin: 0; font-weight: 500; display: flex; align-items: center; gap: 8px"><Icon name="calendar" :size="14" /> {{ t('search.events') }}</h2>
      <button v-for="(e, i) in res.events" :key="e.id ?? i" type="button" :class="['search-ev', { past: !upcoming(e) }]" @click="openedEvent = e">
        <i :style="{ background: e.calendar?.color ?? 'var(--accent)' }" aria-hidden="true" />
        <span class="mono">{{ evWhen(e) }}</span>
        <span class="search-ev-title">{{ e.title }}</span>
        <span v-if="e.location" class="muted ellipsis">{{ e.location }}</span>
      </button>
    </section>
    <EventSheet v-if="openedEvent" :event="openedEvent" @close="openedEvent = null" />
  </template>

  <template v-if="listed.length || open">
    <span v-if="showQuick && !(phone && open)" class="eyebrow">{{ t('search.inMails') }} · {{ listed.length }}</span>
    <div :class="['split', { reading: open }]">
      <section class="list" :aria-label="t('search.found')">
        <button v-for="r in listed" :key="r.id" type="button" class="row" :aria-current="open?.id === r.id" @click="read(r)">
          <span class="mark" :style="{ background: r.relevant ? 'var(--accent)' : 'var(--line)' }" aria-hidden="true" />
          <span class="from">{{ r.fromName }}</span>
          <span class="time">{{ when(r.date) }}</span>
          <span class="subj">{{ r.subject || t('common.noSubject') }}</span>
          <span class="one">
            <span class="mono" style="font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; margin-right: 6px">{{ sourceLabel(r) }}</span>
            {{ r.relevant ? t('search.used') : '' }}{{ r.snippet }}
          </span>
        </button>
      </section>
      <div v-if="open" class="reading-pane">
        <div class="readers">
          <article class="reader rise" :aria-label="t('reader.label')">
            <div class="reader-top">
              <button type="button" class="btn back" @click="closeMail"><Icon name="back" :size="16" /> {{ t('common.back') }}</button>
              <span class="eyebrow" style="font-size: 12px">{{ when(open.date) }}</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 10px; min-width: 0">
              <h2>{{ open.subject || t('common.noSubject') }}</h2>
              <span class="muted" style="font-size: 14px; overflow-wrap: anywhere">{{ open.fromName }} <span class="mono" style="font-size: 12px">&lt;{{ open.fromEmail }}&gt;</span></span>
              <time class="mail-date" :datetime="new Date(open.date).toISOString()">{{ fullDate(open.date) }}</time>
            </div>
            <MailBody :mail-id="open.id" :text="body ?? open.snippet" source="gmail" />
          </article>
        </div>
      </div>
    </div>
  </template>
</template>
