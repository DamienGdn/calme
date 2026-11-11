<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, post, when } from '../api.ts';
import Icon from '../components/Icon.vue';
import { notify, notifyError } from '../store.ts';

type Verdict = 'unsub' | 'maybe' | 'keep';
interface Sender {
  fromName: string;
  fromEmail: string;
  count: number;
  read: number;
  lastDate: number;
  lastRead: number;
  canUnsub: boolean;
  verdict?: Verdict | null;
  reason?: string;
}
interface View {
  senders: Sender[];
  unsubscribed: string[];
}
type Tab = 'advised' | 'keep' | 'all';

const { t } = useI18n();
const host = (u: string) => new URL(u).hostname;
const view = ref<View | null>(null);
const picked = ref(new Set<string>());
const tab = ref<Tab>('advised');
const alsoTrash = ref(true);
const busy = ref<'' | 'scan' | 'unsub'>('');
const toOpen = ref<string[]>([]);

const preselect = (v: View) => new Set(v.senders.filter((s) => s.verdict === 'unsub' && !v.unsubscribed.includes(s.fromEmail)).map((s) => s.fromEmail));

onMounted(async () => {
  try {
    const v = await api<View>('/api/newsletters');
    view.value = v;
    picked.value = preselect(v);
  } catch (e) {
    notifyError(e);
  }
});

const done = computed(() => new Set(view.value?.unsubscribed ?? []));
const active = computed(() => (view.value?.senders ?? []).filter((s) => !done.value.has(s.fromEmail)));
const gone = computed(() => (view.value?.senders ?? []).filter((s) => done.value.has(s.fromEmail)));
const advised = computed(() => active.value.filter((s) => s.verdict !== 'keep'));
const kept = computed(() => active.value.filter((s) => s.verdict === 'keep'));
const shown = computed(() => (tab.value === 'advised' ? advised.value : tab.value === 'keep' ? kept.value : active.value));
const maxCount = computed(() => Math.max(1, ...active.value.map((s) => s.count)));
const sel = computed(() => active.value.filter((s) => picked.value.has(s.fromEmail)));
const saved = computed(() => sel.value.reduce((n, s) => n + s.count, 0));
const readPct = computed(() => (saved.value ? Math.round((sel.value.reduce((n, s) => n + s.read, 0) / saved.value) * 100) : 0));
const nUnsub = computed(() => active.value.filter((s) => s.verdict === 'unsub').length);
const tabs = computed<[Tab, string, number][]>(() => [
  ['advised', t('unsub.tabAdvised'), advised.value.length],
  ['keep', t('unsub.tabKeep'), kept.value.length],
  ['all', t('unsub.tabAll'), active.value.length],
]);

async function scan() {
  busy.value = 'scan';
  try {
    const v = await post<View>('/api/newsletters/scan');
    view.value = v;
    picked.value = preselect(v);
    notify(t('unsub.analyzed', { n: v.senders.length }));
  } catch (e) {
    notifyError(e);
  } finally {
    busy.value = '';
  }
}

async function unsubscribe() {
  busy.value = 'unsub';
  try {
    const r = await post<{ unsubscribed: number; trashed: number; toOpen: string[] }>('/api/newsletters/unsubscribe', { senders: [...picked.value], trash: alsoTrash.value });
    toOpen.value = r.toOpen;
    notify(t('unsub.done', { unsub: r.unsubscribed, trash: alsoTrash.value ? t('unsub.doneTrash', { n: r.trashed }) : '' }));
    const v = await api<View>('/api/newsletters');
    view.value = v;
    picked.value = preselect(v);
  } catch (e) {
    notifyError(e);
  } finally {
    busy.value = '';
  }
}

const toggle = (e: string) => (picked.value.has(e) ? picked.value.delete(e) : picked.value.add(e));
const ratioColor = (s: Sender) => {
  const r = s.count ? s.read / s.count : 0;
  return r > 0.5 ? 'var(--accent-text)' : r === 0 ? 'var(--hot-text)' : 'var(--body)';
};
const verdictClass = (v?: Verdict | null) => ({ unsub: 'v-unsub', maybe: 'v-maybe', keep: 'v-keep' })[v ?? 'maybe'];
</script>

<template>
  <header class="topbar">
    <span class="eyebrow">{{ t('unsub.eyebrow') }}</span>
    <button type="button" :class="['btn', { 'btn-prim': !view?.senders.length }]" :disabled="busy !== ''" @click="scan">
      <Icon name="refresh" :size="16" /> {{ busy === 'scan' ? t('unsub.analyzing') : view?.senders.length ? t('unsub.reanalyze') : t('unsub.analyze') }}
    </button>
  </header>

  <div style="display: flex; flex-wrap: wrap; gap: 28px; align-items: flex-end">
    <h1 class="headline" style="flex: 1 1 480px">
      <template v-if="active.length">
        {{ t('unsub.headline') }} <span class="hot">{{ t('unsub.headlineCount', nUnsub) }}</span> <em>{{ t('unsub.headlineEm', { n: kept.length }) }}</em>
      </template>
      <template v-else>{{ t('unsub.emptyHeadline') }} <em>{{ t('unsub.emptyEm') }}</em></template>
    </h1>
    <div v-if="active.length" class="stats">
      <div><span class="serif">{{ saved }}</span><span>{{ t('unsub.statSaved') }}</span></div>
      <div><span class="serif">{{ readPct }} %</span><span>{{ t('unsub.statRead') }}</span></div>
      <div><span class="serif">{{ active.length }}</span><span>{{ t('unsub.statSenders') }}</span></div>
    </div>
  </div>

  <p v-if="!active.length && view" class="muted" style="margin: 0; max-width: 62ch; line-height: 1.6; font-size: 14px">{{ t('unsub.intro') }}</p>

  <div v-if="toOpen.length" class="banner">
    <p>{{ t('cleanup.confirmSites') }}</p>
    <div style="display: flex; flex-wrap: wrap; gap: 8px">
      <a v-for="u in toOpen" :key="u" class="btn" :href="u" target="_blank" rel="noopener noreferrer">{{ host(u) }}</a>
    </div>
  </div>

  <template v-if="active.length">
    <div class="tones" role="tablist" :aria-label="t('unsub.filter')" style="align-self: flex-start">
      <button v-for="[k, label, n] in tabs" :key="k" type="button" role="tab" :aria-checked="tab === k" :aria-selected="tab === k" style="min-height: 40px" @click="tab = k">
        {{ label }} <span class="mono" style="font-weight: 400; opacity: 0.8">{{ n }}</span>
      </button>
    </div>

    <div class="table">
      <div class="ns ns-head">
        <span /><span>{{ t('unsub.colSender') }}</span><span>{{ t('unsub.colVolume') }}</span><span>{{ t('unsub.colRead') }}</span><span>{{ t('unsub.colAdvice') }}</span>
      </div>
      <label v-for="(s, i) in shown" :key="s.fromEmail" :class="['ns', 'rise', { dimmed: !picked.has(s.fromEmail) && s.verdict === 'unsub' }]" :style="{ animationDelay: `${Math.min(i, 12) * 40}ms` }">
        <input type="checkbox" :checked="picked.has(s.fromEmail)" @change="toggle(s.fromEmail)" />
        <span style="display: flex; flex-direction: column; gap: 2px; min-width: 0">
          <span class="name">{{ s.fromName }}</span>
          <span class="mono muted ellipsis" style="font-size: 11px">{{ s.fromEmail }}</span>
        </span>
        <span style="display: flex; flex-direction: column; gap: 6px">
          <span class="mono" style="font-size: 13px">{{ t('common.mails', s.count) }}</span>
          <span class="bar" aria-hidden="true"><span :style="{ width: `${Math.round((s.count / maxCount) * 100)}%` }" /></span>
        </span>
        <span style="display: flex; flex-direction: column; gap: 2px">
          <span class="mono" :style="{ fontSize: '13px', color: ratioColor(s) }">{{ s.read }} / {{ s.count }}</span>
          <span class="muted" style="font-size: 12px">{{ t('unsub.lastRead', { when: s.lastRead ? when(s.lastRead) : t('unsub.never') }) }}</span>
        </span>
        <span style="display: flex; align-items: flex-start; gap: 12px">
          <span :class="['verdict', verdictClass(s.verdict)]">{{ t(`unsub.verdict.${s.verdict ?? 'none'}`) }}</span>
          <span style="font-size: 13px; line-height: 1.45; color: var(--body)">{{ s.reason || t('unsub.noReason') }}</span>
        </span>
      </label>
      <p v-if="!shown.length" class="empty" style="padding: 24px">{{ t('unsub.emptyTab') }}</p>
    </div>
  </template>

  <section v-if="gone.length" style="display: flex; flex-direction: column; gap: 8px">
    <h2 class="eyebrow" style="margin: 0; font-weight: 500">{{ t('unsub.alreadyGone') }}</h2>
    <p class="muted" style="margin: 0; font-size: 13px; line-height: 1.6">{{ gone.map((s) => s.fromName).join(' · ') }}</p>
  </section>

  <footer v-if="active.length" class="sticky-foot">
    <span class="mono muted" style="flex: 1 1 260px; font-size: 13px">{{ t('unsub.selected', sel.length) }} · {{ t('unsub.savedPerMonth', { n: saved }) }}</span>
    <label style="display: flex; align-items: center; gap: 8px; font-size: 13px">
      <input v-model="alsoTrash" type="checkbox" style="width: 18px; height: 18px; accent-color: var(--accent)" /> {{ t('cleanup.alsoTrash') }}
    </label>
    <button type="button" class="btn btn-prim" style="min-height: 48px; padding: 0 22px" :disabled="!sel.length || busy !== ''" @click="unsubscribe">
      {{ busy === 'unsub' ? t('reader.unsubscribing') : t('unsub.go', { n: sel.length }) }} <Icon name="arrow" :size="16" />
    </button>
  </footer>
</template>
