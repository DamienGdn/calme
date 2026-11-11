<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { fullDate, post, useMailBody, when } from '../api.ts';
import Icon from '../components/Icon.vue';
import MailBody from '../components/MailBody.vue';
import { richText } from '../format.ts';
import { goTo, notifyError } from '../store.ts';
import { useMedia } from '../tabs.ts';

interface Result {
  id: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  date: number;
  relevant: boolean;
  source: 'local' | 'gmail';
}
interface SearchResponse {
  query: string;
  explanation: string;
  /** One short sentence that answers directly (may hold **bold**). */
  lead?: string;
  answer: string;
  /** Short timeline "date — fact" when several mails matter. */
  points?: string[];
  results: Result[];
}

const props = defineProps<{ initial: string }>();
const { t, tm } = useI18n();
const question = ref(props.initial);
const res = ref<SearchResponse | null>(null);
const busy = ref(false);
const open = ref<Result | null>(null);
const body = useMailBody(
  toRef(() => open.value?.id),
  toRef(() => (open.value?.source === 'local' ? 'archive' : 'gmail')),
);
const examples = computed(() => tm('search.examples') as unknown as string[]);
/** "3 nov. — Permis accordé" → date and fact, so the timeline can line the dates up. */
const point = (p: string) => {
  const m = /^(.{2,24}?)\s+[—–-]\s+(.+)$/.exec(p);
  return m ? { date: m[1], text: m[2] } : { date: '', text: p };
};
/** The detail folds after a few lines; the timeline folds behind its title. */
const expanded = ref(false);
const lead = computed(() => (res.value?.lead ? richText(res.value.lead)[0] ?? [] : []));
const answerParas = computed(() => richText(res.value?.answer ?? ''));
const longAnswer = computed(() => (res.value?.answer.length ?? 0) > 260);
watch(res, () => (expanded.value = false));
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
function submit() {
  const q = question.value.trim();
  if (q === props.initial) void run(q, true);
  else goTo('recherche', q);
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
onMounted(() => window.addEventListener('popstate', onPop));
onBeforeUnmount(() => window.removeEventListener('popstate', onPop));
</script>

<template>
  <header class="topbar"><span class="eyebrow">{{ t('search.eyebrow') }}</span></header>

  <template v-if="!(phone && open)">
  <form class="ask-big" role="search" @submit.prevent="submit">
    <span class="dot" aria-hidden="true" />
    <label class="sr" for="q">{{ t('search.label') }}</label>
    <input id="q" v-model="question" :placeholder="t('search.placeholder')" autofocus />
    <button class="btn btn-prim" :disabled="busy || !question.trim()">{{ busy ? t('search.busy') : t('search.go') }}</button>
  </form>

  <div v-if="!res && !busy" style="display: flex; flex-wrap: wrap; gap: 8px">
    <button v-for="x in examples" :key="x" type="button" class="folder" @click="goTo('recherche', x)">{{ x }}</button>
  </div>

  <p v-if="busy" class="empty">{{ t('search.busyLong') }}</p>
  </template>

  <template v-if="res">
    <section v-if="!(phone && open)" class="claude-box" :aria-label="t('search.answer')">
      <span class="eyebrow" style="display: flex; align-items: center; gap: 8px"><span class="dot" /> {{ t('search.answer') }}</span>
      <p v-if="lead.length" class="answer-lead">
        <template v-for="(s, i) in lead" :key="i"><strong v-if="s.bold">{{ s.text }}</strong><template v-else>{{ s.text }}</template></template>
      </p>
      <div v-if="answerParas.length" id="answer-body" :class="['answer', { clamped: longAnswer && !expanded }]">
        <p v-for="(para, i) in answerParas" :key="i">
          <template v-for="(s, j) in para" :key="j"><strong v-if="s.bold">{{ s.text }}</strong><template v-else>{{ s.text }}</template></template>
        </p>
      </div>
      <button v-if="longAnswer" type="button" class="linkish fold" :aria-expanded="expanded" aria-controls="answer-body" @click="expanded = !expanded">
        {{ expanded ? t('search.readLess') : t('search.readMore') }}
      </button>
      <details v-if="res.points?.length" class="points-box">
        <summary>{{ t('search.timeline', { n: res.points.length }) }}</summary>
        <ol class="points">
          <li v-for="(p, i) in res.points" :key="i"><span class="mono">{{ point(p).date }}</span><span>{{ point(p).text }}</span></li>
        </ol>
      </details>
      <span class="mono muted" style="font-size: 12px">{{ t('search.query', { q: res.query, n: t('common.mails', res.results.length) }) }}</span>
    </section>

    <div :class="['split', { reading: open }]">
      <section class="list" :aria-label="t('search.found')">
        <button v-for="r in res.results" :key="r.id" type="button" class="row" :aria-current="open?.id === r.id" @click="read(r)">
          <span class="mark" :style="{ background: r.relevant ? 'var(--accent)' : 'var(--line)' }" aria-hidden="true" />
          <span class="from">{{ r.fromName }}</span>
          <span class="time">{{ when(r.date) }}</span>
          <span class="subj">{{ r.subject || t('common.noSubject') }}</span>
          <span class="one">
            <span class="mono" style="font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; margin-right: 6px">{{ r.source === 'local' ? t('search.local') : t('search.gmail') }}</span>
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
