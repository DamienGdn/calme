<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { CAT_CLASS, CAT_COLOR, post, when, type Category, type MailItem } from '../api.ts';
import Icon from '../components/Icon.vue';
import SwipeRow from '../components/SwipeRow.vue';
import TabBar from '../components/TabBar.vue';
import { axis, swipeBack } from '../gestures.ts';
import { dateLocale } from '../i18n.ts';
import { enablePush, isSubscribed, pushSupported } from '../push.ts';
import { goTo, notify, notifyError, refresh, setRead, store } from '../store.ts';
import { closeTab, cycleTab, openTab, pruneTabs, toggleCompare } from '../tabLogic.ts';
import { tabs, updateTabs, useMedia } from '../tabs.ts';
import { isUnread } from '../unread.ts';
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
/** The rows' entrance animation plays once, not each time the list comes back (phone, after reading a mail). */
const animateRows = ref(true);
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

const phone = useMedia('(max-width: 720px)');

/**
 * Opening a mail on the phone adds a history step, so the system back gesture (and the swipe below) returns to the
 * list instead of leaving Calm.
 */
function openReading() {
  if (phone.value && !reading.value) history.pushState({ calmeReading: true }, '');
  reading.value = true;
}
function closeReading() {
  if (history.state?.calmeReading) history.back();
  else reading.value = false;
}
const onPop = () => (reading.value = Boolean(history.state?.calmeReading));

/** Plain click replaces the open mail; ⌘/Ctrl-click or middle click keeps it in a new tab. */
function select(m: MailItem, background = false) {
  if (background) {
    const shown = current.value;
    updateTabs((st) => openTab(st.active || !shown ? st : openTab(st, shown.id), m.id, true));
    return;
  }
  updateTabs((st) => openTab(st, m.id));
  void setRead([m.id], true);
  openReading();
  if (phone.value) window.scrollTo({ top: 0 });
}

// A mail opened (clicked, tab switched to, from a notification) is read; "Unread" from the mail, a swipe or a
// selection puts it back. On the phone, marking the open mail unread returns to the list, like Gmail.
watch(
  () => [tabs.value.active, Boolean(store.state)] as const,
  ([id, loaded]) => {
    if (id && loaded) void setRead([id], true);
  },
  { immediate: true },
);
function toggleRead(m: MailItem) {
  const unread = isUnread(m);
  void setRead([m.id], unread);
  if (!unread && phone.value && reading.value && current.value?.id === m.id) closeReading();
}

// Selection: long press (phone) or ⇧-click starts it; while selecting, a tap toggles a mail.
const selected = ref(new Set<string>());
const selecting = computed(() => selected.value.size > 0);
function toggleSelected(id: string) {
  const next = new Set(selected.value);
  if (!next.delete(id)) next.add(id);
  selected.value = next;
}
const clearSelection = () => (selected.value = new Set());
const selectAll = () => (selected.value = new Set(list.value.map((m) => m.id)));
watch(emails, (all) => {
  const ids = new Set(all.map((m) => m.id));
  if ([...selected.value].some((id) => !ids.has(id))) selected.value = new Set([...selected.value].filter((id) => ids.has(id)));
});

function onRowClick(e: MouseEvent, m: MailItem) {
  if (selecting.value || e.shiftKey) toggleSelected(m.id);
  else select(m, e.metaKey || e.ctrlKey);
}

/** Undo for trash: Gmail untrashes, the mails come back to the inbox. */
const undoTrash = (ids: string[]) => ({
  label: t('common.undo'),
  run: async () => {
    try {
      for (const id of ids) await post(`/api/mail/${encodeURIComponent(id)}/untrash`);
      notify(t('triage.restored', ids.length));
      await refresh();
    } catch (e) {
      notifyError(e);
    }
  },
});

/** Undo for "handled": the mail goes back to "to answer". */
const undoHandled = (id: string) => ({
  label: t('common.undo'),
  run: async () => {
    try {
      await post(`/api/mail/${encodeURIComponent(id)}/category`, { category: 'reply' });
      notify(t('triage.backToReply'));
      await refresh();
    } catch (e) {
      notifyError(e);
    }
  },
});

/** The selection goes unread, or read when every selected mail is already unread. */
const selectionUnread = computed(() => [...selected.value].every((id) => { const m = byId(id); return m ? isUnread(m) : true; }));
async function readSelection() {
  const ids = [...selected.value];
  if (!ids.length) return;
  const read = selectionUnread.value;
  clearSelection();
  await setRead(ids, read);
}

async function trashSelection() {
  const ids = [...selected.value];
  if (!ids.length || busy.value) return;
  busy.value = true;
  try {
    await post('/api/cleanup', { trashIds: ids });
    clearSelection();
    notify(t('triage.trashedMany', ids.length), false, undoTrash(ids));
    await refresh();
  } catch (e) {
    notifyError(e);
  } finally {
    busy.value = false;
  }
}

// Swipe right on the open mail (phone) goes back to the list.
const backDx = ref(0);
let backStart: { x: number; y: number; t: number } | null = null;
let backLock: 'x' | 'y' | null = null;
function backDown(e: PointerEvent) {
  if (e.pointerType !== 'touch' || !phone.value || !reading.value) return;
  backStart = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  backLock = null;
}
function backMove(e: PointerEvent) {
  if (!backStart) return;
  backLock ??= axis(e.clientX - backStart.x, e.clientY - backStart.y);
  if (backLock === 'x') backDx.value = Math.max(0, e.clientX - backStart.x);
  else if (backLock === 'y') backStart = null;
}
function backUp(e: PointerEvent) {
  const go = backStart && backLock === 'x' && swipeBack(e.clientX - backStart.x, window.innerWidth, e.timeStamp - backStart.t);
  backStart = null;
  backDx.value = 0;
  if (go) closeReading();
}

async function act(mail: MailItem | null, path: string, done: string, body?: unknown) {
  if (!mail) return;
  busy.value = true;
  try {
    await post(`/api/mail/${encodeURIComponent(mail.id)}/${path}`, body);
    notify(done, false, path === 'trash' ? undoTrash([mail.id]) : path === 'category' ? undoHandled(mail.id) : undefined);
    if (tabs.value.ids.length > 1 && tabs.value.ids.includes(mail.id)) {
      updateTabs((st) => closeTab(st, mail.id));
    } else {
      const idx = list.value.findIndex((m) => m.id === mail.id);
      const next = list.value[idx + 1] ?? list.value[idx - 1];
      updateTabs((st) => (next ? openTab(st, next.id) : closeTab(st, mail.id)));
      if (!next && reading.value) closeReading();
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
// Return = trash the open mail, or the selection (Gmail trash, recoverable 30 days, with Undo) · Escape = end the
// selection · ← → switch tab · X close tab · C compare.
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
  if (e.key === 'Escape' && selecting.value) {
    clearSelection();
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey && onPage) {
    e.preventDefault();
    if (busy.value) return;
    if (selecting.value) void trashSelection();
    else void trash(current.value);
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
// The screen stays alive while another tab is shown (App.vue): its keys and back gesture only while it is visible.
onActivated(() => {
  window.addEventListener('keydown', onKey);
  window.addEventListener('popstate', onPop);
});
onDeactivated(() => {
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('popstate', onPop);
});
onMounted(() => {
  window.setTimeout(() => (animateRows.value = false), 1500);
  if (canPush) void isSubscribed().then((v) => (pushOn.value = v));
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
    <header class="topbar triage-bar">
      <span class="eyebrow">{{ meta }}</span>
      <label class="field">
        <span class="muted" style="display: flex"><Icon name="search" :size="16" /></span>
        <span class="sr">{{ t('triage.searchLabel') }}</span>
        <input v-model="query" type="search" :placeholder="t('triage.filterPlaceholder')" @keydown.enter="askCalme" />
      </label>
      <button v-if="!pushOn && canPush" type="button" class="btn" :aria-label="t('triage.enablePush')" @click="turnOnPush"><Icon name="bell" :size="16" /> <span class="wide-only">{{ t('triage.enablePush') }}</span></button>
      <button type="button" class="btn btn-prim" :disabled="store.state?.running" :aria-label="t('common.sync')" @click="sync">
        <Icon name="refresh" :size="16" /> <span class="wide-only">{{ store.state?.running ? t('common.syncing') : t('common.sync') }}</span>
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
      <div v-if="selecting" class="selbar" role="toolbar" :aria-label="t('triage.selection')">
        <button type="button" class="btn btn-icon" :aria-label="t('triage.clearSelection')" @click="clearSelection">×</button>
        <span class="grow">{{ t('triage.selected', selected.size) }}</span>
        <button type="button" class="btn" @click="selectAll">{{ t('triage.selectAll') }}</button>
        <button type="button" class="btn" @click="readSelection"><Icon name="mail" :size="16" /> {{ selectionUnread ? t('triage.markRead') : t('triage.markUnread') }}</button>
        <button type="button" class="btn btn-danger" :disabled="busy" @click="trashSelection"><Icon name="trash" :size="16" /> {{ t('triage.trashShort') }}</button>
      </div>
      <SwipeRow
        v-for="(m, i) in list"
        :key="m.id"
        :trash-label="t('triage.trashShort')"
        :read-label="isUnread(m) ? t('triage.markRead') : t('triage.markUnread')"
        @trash="trash(m)"
        @read="toggleRead(m)"
        @hold="toggleSelected(m.id)"
      >
        <button
          type="button"
          :class="['row', { rise: animateRows, open: tabs.ids.includes(m.id), picked: selected.has(m.id), unread: isUnread(m) }]"
          :style="{ animationDelay: `${Math.min(i, 10) * 50}ms` }"
          :aria-current="!selecting && current?.id === m.id"
          :aria-pressed="selecting ? selected.has(m.id) : undefined"
          :title="t('tabs.rowHint')"
          @click="onRowClick($event, m)"
          @auxclick="$event.button === 1 && select(m, true)"
        >
          <span v-if="selecting" class="pick" aria-hidden="true"><Icon v-if="selected.has(m.id)" name="check" :size="12" /></span>
          <span v-else class="mark" :style="{ background: m.analysis ? CAT_COLOR[m.analysis.category] : 'var(--line)' }" aria-hidden="true" />
          <span class="from">{{ m.fromName }}</span>
          <span class="time"><i v-if="isUnread(m)" class="udot" /><span v-if="isUnread(m)" class="sr">{{ t('triage.unread') }}, </span>{{ when(m.date) }}</span>
          <span class="subj">{{ m.subject || t('common.noSubject') }}</span>
          <span class="one">{{ m.analysis?.summary[0] ?? (m.analysis ? m.snippet : t('triage.notRead')) }}</span>
        </button>
      </SwipeRow>
      <p v-if="!list.length" class="empty">{{ store.state ? t('common.nothingHere') : t('common.loading') }}</p>
    </section>

    <div
      v-if="current"
      :class="['reading-pane', { 'has-tabs': showTabs }]"
      :style="backDx ? { transform: `translateX(${backDx}px)`, opacity: String(1 - backDx / 700) } : undefined"
      @pointerdown="backDown"
      @pointermove="backMove"
      @pointerup="backUp"
      @pointercancel="backDx = 0"
    >
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
          @back="closeReading"
          @archive="act(current, 'archive', t('triage.archived'))"
          @trash="trash(current)"
          @handled="act(current, 'category', t('triage.handledToast'), { category: 'read' })"
          @label="(id, name) => act(current, 'label', t('triage.filed', { name }), { labelId: id })"
          @toggle-read="toggleRead(current)"
        />
        <Reader
          v-if="second"
          :key="`cmp-${second.id}`"
          :mail="second"
          :busy="busy"
          @back="closeReading"
          @archive="act(second, 'archive', t('triage.archived'))"
          @trash="trash(second)"
          @handled="act(second, 'category', t('triage.handledToast'), { category: 'read' })"
          @label="(id, name) => act(second, 'label', t('triage.filed', { name }), { labelId: id })"
          @toggle-read="toggleRead(second)"
        />
      </div>
    </div>
  </div>
</template>
