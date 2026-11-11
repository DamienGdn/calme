<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { CAT_CLASS, CAT_COLOR, post, when, type Category, type MailItem } from '../api.ts';
import Icon from '../components/Icon.vue';
import { dateLocale } from '../i18n.ts';
import { enablePush, isSubscribed, pushSupported } from '../push.ts';
import { goTo, notify, notifyError, openEditor, refresh, store, toggleTheme } from '../store.ts';
import Reader from './Reader.vue';

const props = defineProps<{ filter: Category | 'all' }>();
const { t } = useI18n();
const ORDER: Category[] = ['reply', 'read', 'news', 'trash'];

const query = ref('');
const selId = ref<string | null>(new URLSearchParams(location.search).get('mail'));
const reading = ref(Boolean(selId.value));
const pushOn = ref(true);
const busy = ref(false);
const canPush = pushSupported() && !window.calmeDesktop;

const emails = computed(() => store.state?.emails ?? []);
const list = computed(() => {
  const q = query.value.trim().toLowerCase();
  return emails.value.filter(
    (m) =>
      (props.filter === 'all' || m.analysis?.category === props.filter) &&
      (!q || `${m.fromName} ${m.fromEmail} ${m.subject} ${m.snippet} ${m.analysis?.summary.join(' ') ?? ''}`.toLowerCase().includes(q)),
  );
});
const current = computed(() => list.value.find((m) => m.id === selId.value) ?? emails.value.find((m) => m.id === selId.value) ?? list.value[0] ?? null);
const counts = computed(() => store.state?.counts ?? { reply: 0, read: 0, news: 0, trash: 0 });
const total = computed(() => ORDER.reduce((n, k) => n + counts.value[k], 0));
const setFilter = (f: Category | 'all') => goTo('tri', f === 'all' ? '' : f);

const meta = computed(() => {
  const s = store.state;
  return t('triage.meta', {
    today: new Date().toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' }),
    sync: s?.lastSync ? t('triage.synced', { when: when(s.lastSync) }) : t('triage.neverSynced'),
    rest: s?.analyzing ? t('triage.analyzing', { n: s.analyzing }) : t('triage.inBox', { n: emails.value.length }),
  });
});

function select(m: MailItem) {
  selId.value = m.id;
  reading.value = true;
  if (window.matchMedia('(max-width: 720px)').matches) window.scrollTo({ top: 0 });
}

async function act(path: string, done: string, body?: unknown) {
  const cur = current.value;
  if (!cur) return;
  busy.value = true;
  try {
    await post(`/api/mail/${encodeURIComponent(cur.id)}/${path}`, body);
    notify(done);
    const idx = list.value.findIndex((m) => m.id === cur.id);
    const next = list.value[idx + 1] ?? list.value[idx - 1];
    selId.value = next?.id ?? null;
    if (!next) reading.value = false;
    await refresh();
  } catch (e) {
    notifyError(e);
  } finally {
    busy.value = false;
  }
}
const trashCurrent = () => current.value && act('trash', t('triage.trashed', { subject: current.value.subject || t('common.noSubject') }));

// Return = put the open mail in the trash (Gmail trash, recoverable 30 days); ignored in fields and on other controls.
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.repeat || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  const target = e.target as HTMLElement | null;
  if (target && target !== document.body && !target.closest('.row')) return;
  e.preventDefault();
  if (!busy.value) void trashCurrent();
}
onMounted(() => {
  window.addEventListener('keydown', onKey);
  if (canPush) void isSubscribed().then((v) => (pushOn.value = v));
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

async function sync() {
  try {
    await post('/api/sync');
    notify(t('common.syncStarted'));
    window.setTimeout(refresh, 1500);
  } catch (e) {
    notifyError(e);
  }
}
async function turnOnPush() {
  try {
    await enablePush();
    pushOn.value = true;
    notify(t('triage.pushOn'));
  } catch (e) {
    notifyError(e);
  }
}
function askCalme() {
  if (query.value.trim()) goTo('recherche', query.value.trim());
}
</script>

<template>
  <div :class="['overview', { 'hide-mobile': reading }]">
    <header class="topbar">
      <span class="eyebrow">{{ meta }}</span>
      <label class="field" style="flex: 0 1 340px">
        <span class="muted" style="display: flex"><Icon name="search" :size="16" /></span>
        <span class="sr">{{ t('triage.searchLabel') }}</span>
        <input v-model="query" type="search" :placeholder="t('triage.filterPlaceholder')" @keydown.enter="askCalme" />
      </label>
      <button v-if="!pushOn && canPush" type="button" class="btn" @click="turnOnPush"><Icon name="bell" :size="16" /> {{ t('triage.enablePush') }}</button>
      <a href="#/ecrire" class="btn btn-icon mobile-only" :aria-label="t('nav.newMessage')" @click="openEditor({})"><Icon name="pen" :size="18" /></a>
      <button type="button" class="btn btn-icon mobile-only" :aria-label="store.theme === 'dark' ? t('common.toLight') : t('common.toDark')" @click="toggleTheme">
        <Icon :name="store.theme === 'dark' ? 'sun' : 'moon'" :size="18" />
      </button>
      <button type="button" class="btn btn-prim" :disabled="store.state?.running" @click="sync">
        <Icon name="refresh" :size="16" /> {{ store.state?.running ? t('common.syncing') : t('common.sync') }}
      </button>
    </header>

    <div v-if="store.state?.gmail === 'no-credentials'" class="banner">
      <i18n-t keypath="triage.noCredentials" tag="p">
        <template #file><code class="mono">credentials.json</code></template>
        <template #dir><code class="mono">~/.calme/</code></template>
      </i18n-t>
    </div>
    <div v-else-if="store.state?.gmail === 'disconnected'" class="banner">
      <p>{{ t('triage.disconnected') }}</p>
      <a class="btn btn-prim" href="/auth/google" target="_blank" rel="opener">{{ t('triage.connect') }}</a>
    </div>
    <div v-else-if="store.state?.error" class="banner"><p>{{ t('triage.lastError', { error: store.state.error }) }}</p></div>

    <h1 class="headline">
      <template v-if="counts.reply > 0">
        <span class="hot">{{ t('triage.headlineReply', counts.reply) }}</span> {{ t('triage.headlineRest') }} <em>{{ t('triage.headlineEm') }}</em>
      </template>
      <template v-else>{{ t('triage.headlineNone') }} <em>{{ t('triage.headlineNoneEm') }}</em></template>
    </h1>

    <section v-if="total > 0" style="display: flex; flex-direction: column; gap: 10px">
      <div style="display: flex; align-items: baseline; gap: 12px">
        <span class="eyebrow">{{ t('triage.sortTitle') }}</span>
        <button v-if="filter !== 'all'" type="button" style="border: 0; background: none; padding: 0; font-size: 13px; text-decoration: underline; text-underline-offset: 3px" @click="setFilter('all')">
          {{ t('triage.showAll') }}
        </button>
      </div>
      <div class="segs" role="tablist" :aria-label="t('triage.categories')">
        <button
          v-for="k in ORDER"
          :key="k"
          type="button"
          role="tab"
          :aria-selected="filter === k"
          :class="['seg', CAT_CLASS[k], { dim: filter !== 'all' && filter !== k }]"
          :style="{ flex: `${Math.max(counts[k], 1)} 1 120px` }"
          @click="setFilter(filter === k ? 'all' : k)"
        >
          <span class="n">{{ counts[k] }}</span>
          <span class="l">{{ t(`cat.${k}`) }}</span>
        </button>
      </div>
    </section>
  </div>

  <div :class="['split', { reading }]">
    <section class="list" :aria-label="t('triage.mails')">
      <button
        v-for="(m, i) in list"
        :key="m.id"
        type="button"
        class="row rise"
        :style="{ animationDelay: `${Math.min(i, 10) * 50}ms` }"
        :aria-current="current?.id === m.id"
        @click="select(m)"
      >
        <span class="mark" :style="{ background: m.analysis ? CAT_COLOR[m.analysis.category] : 'var(--line)' }" aria-hidden="true" />
        <span class="from">{{ m.fromName }}</span>
        <span class="time">{{ when(m.date) }}</span>
        <span class="subj">{{ m.subject || t('common.noSubject') }}</span>
        <span class="one">{{ m.analysis?.summary[0] ?? (m.analysis ? m.snippet : t('triage.notRead')) }}</span>
      </button>
      <p v-if="!list.length" class="empty">{{ store.state ? t('common.nothingHere') : t('common.loading') }}</p>
    </section>

    <Reader
      v-if="current"
      :key="current.id"
      :mail="current"
      :busy="busy"
      @back="reading = false"
      @archive="act('archive', t('triage.archived'))"
      @trash="trashCurrent"
      @label="(id, name) => act('label', t('triage.filed', { name }), { labelId: id })"
    />
  </div>
</template>
