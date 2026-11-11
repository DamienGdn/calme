<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { CAT_CLASS, CAT_COLOR, post, when, type Category, type MailItem } from '../api.ts';
import Icon from '../components/Icon.vue';
import TabBar from '../components/TabBar.vue';
import { dateLocale } from '../i18n.ts';
import { enablePush, isSubscribed, pushSupported } from '../push.ts';
import { goTo, notify, notifyError, openEditor, refresh, store, toggleTheme } from '../store.ts';
import { closeTab, cycleTab, openTab, pruneTabs, toggleCompare } from '../tabLogic.ts';
import { tabs, updateTabs, useMedia } from '../tabs.ts';
import Reader from './Reader.vue';

const props = defineProps<{ filter: Category | 'all' }>();
const { t } = useI18n();
const ORDER: Category[] = ['reply', 'read', 'news', 'trash'];

const query = ref('');
const fromNotification = new URLSearchParams(location.search).get('mail');
if (fromNotification) updateTabs((st) => openTab(st, fromNotification));
const reading = ref(Boolean(fromNotification));
const wide = useMedia('(min-width: 1180px)');
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
const byId = (id: string | null) => (id ? (emails.value.find((m) => m.id === id) ?? null) : null);
const current = computed(() => byId(tabs.value.active) ?? list.value[0] ?? null);
const second = computed(() => (wide.value ? byId(tabs.value.compare) : null));
const comparing = computed(() => Boolean(current.value && second.value));
const tabItems = computed(() =>
  tabs.value.ids.flatMap((id) => {
    const m = byId(id);
    const color = m?.analysis ? CAT_COLOR[m.analysis.category] : 'var(--line)';
    return m ? [{ id, name: m.fromName, subject: m.subject || t('common.noSubject'), color }] : [];
  }),
);
const showTabs = computed(() => tabItems.value.length > 1);
// Mails archived, trashed or synced away lose their tab.
watch(emails, (list) => {
  if (store.state) updateTabs((st) => pruneTabs(st, new Set(list.map((m) => m.id))));
});
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

/** Plain click replaces the open mail; ⌘/Ctrl-click, middle click or long press keeps it in a new tab. */
function select(m: MailItem, background = false) {
  if (background) {
    const shown = current.value;
    updateTabs((st) => openTab(st.active || !shown ? st : openTab(st, shown.id), m.id, true));
    if (!wide.value) notify(t('tabs.added'));
    return;
  }
  updateTabs((st) => openTab(st, m.id));
  reading.value = true;
  if (window.matchMedia('(max-width: 720px)').matches) window.scrollTo({ top: 0 });
}
function onRowClick(e: MouseEvent, m: MailItem) {
  if (pressFired) {
    pressFired = false;
    return;
  }
  select(m, e.metaKey || e.ctrlKey);
}
let pressTimer = 0;
let pressFired = false;
function pressStart(e: PointerEvent, m: MailItem) {
  if (e.pointerType !== 'touch') return;
  pressFired = false;
  pressTimer = window.setTimeout(() => {
    pressFired = true;
    navigator.vibrate?.(10);
    select(m, true);
  }, 500);
}
const pressEnd = () => window.clearTimeout(pressTimer);

async function act(mail: MailItem | null, path: string, done: string, body?: unknown) {
  if (!mail) return;
  busy.value = true;
  try {
    await post(`/api/mail/${encodeURIComponent(mail.id)}/${path}`, body);
    notify(done);
    if (tabs.value.ids.length > 1 && tabs.value.ids.includes(mail.id)) {
      updateTabs((st) => closeTab(st, mail.id));
    } else {
      const idx = list.value.findIndex((m) => m.id === mail.id);
      const next = list.value[idx + 1] ?? list.value[idx - 1];
      updateTabs((st) => (next ? openTab(st, next.id) : closeTab(st, mail.id)));
      if (!next) reading.value = false;
    }
    await refresh();
  } catch (e) {
    notifyError(e);
  } finally {
    busy.value = false;
  }
}
const trash = (m: MailItem | null) => m && act(m, 'trash', t('triage.trashed', { subject: m.subject || t('common.noSubject') }));

// Keyboard, ignored in fields and on other controls:
// Return = trash the open mail (Gmail trash, recoverable 30 days) · ← → switch tab · X close tab · C compare.
function onKey(e: KeyboardEvent) {
  if (e.repeat || e.isComposing) return;
  const target = e.target as HTMLElement | null;
  const onPage = !target || target === document.body || Boolean(target.closest('.row'));
  if (e.ctrlKey && e.key === 'Tab' && !e.metaKey && !e.altKey) {
    e.preventDefault();
    updateTabs((st) => cycleTab(st, e.shiftKey ? -1 : 1));
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Enter' && !e.shiftKey && onPage) {
    e.preventDefault();
    if (!busy.value) void trash(current.value);
    return;
  }
  if (!onPage && !target?.closest('.tab-main')) return;
  const k = e.key.toLowerCase();
  if (k === 'arrowright' || k === 'arrowleft') {
    if (tabs.value.ids.length < 2) return;
    e.preventDefault();
    updateTabs((st) => cycleTab(st, k === 'arrowright' ? 1 : -1));
    if (target?.closest('.tab-main')) queueMicrotask(() => document.querySelector<HTMLElement>('.tab.on .tab-main')?.focus());
  } else if (k === 'x' && tabs.value.active) {
    updateTabs((st) => closeTab(st, st.active!));
  } else if (k === 'c' && wide.value) {
    updateTabs(toggleCompare);
  }
}
onMounted(() => {
  window.addEventListener('keydown', onKey);
  if (canPush) void isSubscribed().then((v) => (pushOn.value = v));
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  pressEnd();
});

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

  <div :class="['split', { reading, comparing }]">
    <section class="list" :aria-label="t('triage.mails')">
      <button
        v-for="(m, i) in list"
        :key="m.id"
        type="button"
        :class="['row rise', { open: tabs.ids.includes(m.id) }]"
        :style="{ animationDelay: `${Math.min(i, 10) * 50}ms` }"
        :aria-current="current?.id === m.id"
        :title="t('tabs.rowHint')"
        @click="onRowClick($event, m)"
        @auxclick="$event.button === 1 && select(m, true)"
        @pointerdown="pressStart($event, m)"
        @pointerup="pressEnd"
        @pointercancel="pressEnd"
        @pointerleave="pressEnd"
        @contextmenu="pressFired && $event.preventDefault()"
      >
        <span class="mark" :style="{ background: m.analysis ? CAT_COLOR[m.analysis.category] : 'var(--line)' }" aria-hidden="true" />
        <span class="from">{{ m.fromName }}</span>
        <span class="time">{{ when(m.date) }}</span>
        <span class="subj">{{ m.subject || t('common.noSubject') }}</span>
        <span class="one">{{ m.analysis?.summary[0] ?? (m.analysis ? m.snippet : t('triage.notRead')) }}</span>
      </button>
      <p v-if="!list.length" class="empty">{{ store.state ? t('common.nothingHere') : t('common.loading') }}</p>
    </section>

    <div v-if="current" :class="['reading-pane', { 'has-tabs': showTabs }]">
      <TabBar
        v-if="showTabs"
        :items="tabItems"
        :active="current.id"
        :compare="second?.id ?? null"
        :can-compare="wide"
        @select="(id) => updateTabs((st) => openTab(st, id))"
        @close="(id) => updateTabs((st) => closeTab(st, id))"
        @compare="updateTabs(toggleCompare)"
      />
      <div class="readers">
        <Reader
          :key="current.id"
          :mail="current"
          :busy="busy"
          @back="reading = false"
          @archive="act(current, 'archive', t('triage.archived'))"
          @trash="trash(current)"
          @label="(id, name) => act(current, 'label', t('triage.filed', { name }), { labelId: id })"
        />
        <Reader
          v-if="second"
          :key="`cmp-${second.id}`"
          :mail="second"
          :busy="busy"
          @back="reading = false"
          @archive="act(second, 'archive', t('triage.archived'))"
          @trash="trash(second)"
          @label="(id, name) => act(second, 'label', t('triage.filed', { name }), { labelId: id })"
        />
      </div>
    </div>
  </div>
</template>
