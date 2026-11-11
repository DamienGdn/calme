<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { post, useMailBody, when } from '../api.ts';
import Icon from '../components/Icon.vue';
import { goTo, notifyError } from '../store.ts';

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
  answer: string;
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

async function run(q: string) {
  if (!q.trim()) return;
  busy.value = true;
  res.value = null;
  open.value = null;
  try {
    res.value = await post<SearchResponse>('/api/search', { question: q });
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
  if (q === props.initial) void run(q);
  else goTo('recherche', q);
}
</script>

<template>
  <header class="topbar"><span class="eyebrow">{{ t('search.eyebrow') }}</span></header>

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

  <template v-if="res">
    <section class="claude-box" :aria-label="t('search.answer')">
      <span class="eyebrow" style="display: flex; align-items: center; gap: 8px"><span class="dot" /> {{ t('search.answer') }}</span>
      <p class="serif" style="margin: 0; font-size: 24px; line-height: 1.3">{{ res.answer }}</p>
      <span class="mono muted" style="font-size: 12px">{{ t('search.query', { q: res.query, n: t('common.mails', res.results.length) }) }}</span>
    </section>

    <div :class="['split', { reading: open }]">
      <section class="list" :aria-label="t('search.found')">
        <button v-for="r in res.results" :key="r.id" type="button" class="row" :aria-current="open?.id === r.id" @click="open = r">
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
      <article v-if="open" class="reader rise" :aria-label="t('reader.label')">
        <button type="button" class="btn back" style="align-self: flex-start" @click="open = null"><Icon name="back" :size="16" /> {{ t('common.back') }}</button>
        <div style="display: flex; flex-direction: column; gap: 10px">
          <span class="eyebrow">{{ when(open.date) }}</span>
          <h2>{{ open.subject || t('common.noSubject') }}</h2>
          <span class="muted" style="font-size: 14px; overflow-wrap: anywhere">{{ open.fromName }} <span class="mono" style="font-size: 12px">&lt;{{ open.fromEmail }}&gt;</span></span>
        </div>
        <div class="mail-body">{{ body ?? open.snippet }}</div>
      </article>
    </div>
  </template>
</template>
