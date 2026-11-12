<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, CAT_COLOR, type Category } from './api.ts';
import GlassLayer from './components/GlassLayer.vue';
import Icon, { type IconName } from './components/Icon.vue';
import PairRequests from './components/PairRequests.vue';
import QuotaGauge from './components/QuotaGauge.vue';
import { setLang } from './i18n.ts';
import { registerWorker } from './push.ts';
import Admin from './screens/Admin.vue';
import Agenda from './screens/Agenda.vue';
import Cleanup from './screens/Cleanup.vue';
import Editor from './screens/Editor.vue';
import Folders from './screens/Folders.vue';
import Newsletters from './screens/Newsletters.vue';
import Pairing from './screens/Pairing.vue';
import Reminders from './screens/Reminders.vue';
import Search from './screens/Search.vue';
import Setup from './screens/Setup.vue';
import Triage from './screens/Triage.vue';
import { glassBackdrop } from './glass.ts';
import { draft, parseHash, refresh, runToastAction, store, type Route } from './store.ts';

const version = __APP_VERSION__;
/** Access requests from other screens are approved only on the computer running Calm. */
const onComputer = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);

// Liquid glass: the refraction filter is drawn for the menu bar's size, and redrawn when the bar or the settings change.
const tabbarEl = ref<HTMLElement | null>(null);
const barSize = ref({ w: 0, h: 0 });
let glassObserver: ResizeObserver | null = null;
watch(tabbarEl, (el) => {
  glassObserver?.disconnect();
  if (!el) return;
  glassObserver = new ResizeObserver(() => {
    const w = Math.round(el.offsetWidth);
    const h = Math.round(el.offsetHeight);
    if (w !== barSize.value.w || h !== barSize.value.h) barSize.value = { w, h };
    placePill();
  });
  glassObserver.observe(el);
});
const glassStyle = computed(() => {
  const { w, h } = barSize.value;
  return { '--glass-backdrop': glassBackdrop(w, h, h / 2, store.glass) };
});
onBeforeUnmount(() => glassObserver?.disconnect());

const { t, locale } = useI18n();
const loc = ref(parseHash());
const labels = ref<{ id: string; name: string }[]>([]);
const FILTERS: (Category | 'all')[] = ['all', 'reply', 'read', 'news', 'trash'];
const CATS: Category[] = ['reply', 'read', 'news', 'trash'];

const onHash = () => (loc.value = parseHash());
let poll = 0;
const onFocus = () => void refresh();
onMounted(() => {
  window.addEventListener('hashchange', onHash);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('keydown', onMenuKey);
  window.addEventListener('resize', placePill);
  void registerWorker();
});
onBeforeUnmount(() => {
  window.removeEventListener('hashchange', onHash);
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('keydown', onMenuKey);
  window.removeEventListener('resize', placePill);
  window.removeEventListener('focus', onFocus);
  window.clearInterval(poll);
});

watch(
  () => store.paired,
  (paired) => {
    window.clearInterval(poll);
    window.removeEventListener('focus', onFocus);
    if (!paired) return;
    void refresh();
    poll = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', onFocus);
  },
  { immediate: true },
);

// Follow the language chosen on the server (shared by every screen, the desktop app and Calm's own texts).
watch(
  () => store.state?.language,
  (lang) => {
    if (lang && lang !== locale.value) setLang(lang);
  },
);

watch(
  () => [store.state?.gmail, store.labelsVersion] as const,
  ([g]) => {
    if (g === 'connected') api<{ id: string; name: string }[]>('/api/labels').then((l) => (labels.value = l)).catch(() => (labels.value = []));
  },
);

// While a cycle runs on the server, refresh more often so new mails appear quickly.
let fast = 0;
watch(
  () => store.state,
  (s) => {
    window.clearTimeout(fast);
    if (s?.running || s?.analyzing) fast = window.setTimeout(refresh, 4000);
  },
);

// Moving between pages: the tab screens stay alive (no reload, no blank flash, the bar does not move), and each
// page comes back where it was scrolled; a new page starts at the top.
const KEPT = ['Triage', 'Cleanup', 'Agenda', 'Folders', 'Search', 'Reminders'];
const scrolls = new Map<string, number>();
watch(loc, (to, from) => {
  scrolls.set(`${from.route}/${from.arg}`, window.scrollY);
  menuOpen.value = false;
  void nextTick(() => {
    window.scrollTo({ top: scrolls.get(`${to.route}/${to.arg}`) ?? 0 });
    lastY = window.scrollY;
    mini.value = false;
  });
});

const route = computed<Route>(() => loc.value.route);
const filter = computed(() => (route.value === 'tri' && (FILTERS as string[]).includes(loc.value.arg) ? (loc.value.arg as Category | 'all') : 'all'));
const counts = computed(() => store.state?.counts ?? { reply: 0, read: 0, news: 0, trash: 0 });
const healthy = computed(() => store.state?.gmail === 'connected' && !store.state.error);
const tools: { r: Route; label: string; icon: IconName }[] = [
  { r: 'menage', label: 'nav.cleanup', icon: 'trash' },
  { r: 'desabonnements', label: 'nav.unsubscribe', icon: 'unsub' },
  { r: 'agenda', label: 'nav.agenda', icon: 'calendar' },
  { r: 'rappels', label: 'nav.reminders', icon: 'clock' },
];
const tabs: [Route, string, IconName][] = [
  ['tri', 'nav.mail', 'mail'],
  ['rappels', 'nav.reminders', 'clock'],
  ['agenda', 'nav.agenda', 'calendar'],
  ['dossiers', 'nav.folders', 'folder'],
  ['recherche', 'nav.searchTab', 'search'],
];
const onTab = computed(() => tabs.some(([r]) => r === route.value));

// Phone menu bar, like iOS: scrolling down shrinks it to the current tab and a search button; scrolling up (or
// changing page) brings it back. The selected tab's pill is one element that slides, so the glass can follow it.
const mini = ref(false);
let lastY = 0;
function onScroll() {
  const y = window.scrollY;
  if (Math.abs(y - lastY) < 10) return;
  mini.value = y > lastY && y > 90;
  lastY = y;
}
const tabEls = ref<HTMLElement[]>([]);
const pillEl = ref<HTMLElement | null>(null);
const pillBox = ref({ x: 0, y: 0, w: 0, h: 0 });
const pillMoves = ref(0);
function placePill() {
  const i = tabs.findIndex(([r]) => r === route.value);
  const el = i >= 0 ? tabEls.value[i] : null;
  pillBox.value = el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : { x: 0, y: 0, w: 0, h: 0 };
  pillMoves.value++;
}
watch([route, mini], () => void nextTick(placePill));
const dark = computed(() => store.theme === 'dark');
/** Shrunk bar: a tap on its tab opens it again (the next scroll down shrinks it back). */
function unfold(e: MouseEvent, r: Route) {
  if (!mini.value || r !== route.value) return;
  e.preventDefault();
  mini.value = false;
  lastY = window.scrollY;
}

// Top menu (phone): who is signed in, settings, reminders, version.
const menuOpen = ref(false);
const account = ref<{ email: string | null; name: string | null } | null>(null);
watch(
  () => store.state?.gmail,
  (g) => {
    if (g === 'connected' && !account.value) api<{ email: string | null; name: string | null }>('/api/account').then((a) => (account.value = a)).catch(() => {});
  },
  { immediate: true },
);
const initial = computed(() => (account.value?.name || account.value?.email || 'C').trim().charAt(0).toUpperCase());
const onMenuKey = (e: KeyboardEvent) => e.key === 'Escape' && (menuOpen.value = false);
const depth = (name: string) => name.split('/').length - 1;
</script>

<template>
  <Pairing v-if="!store.paired" />
  <Setup v-else-if="store.state && (store.state.setupDone === false || route === 'installation')" />
  <div v-else class="shell">
    <aside class="sidebar" :aria-label="t('nav.main')">
      <div class="brand">
        <span class="logo" aria-hidden="true">c.</span>
        <span class="wordmark">Calm<span class="wordmark-dot">.</span></span>
      </div>

      <a href="#/ecrire" class="btn btn-prim" style="min-height: 44px" @click="draft = {}"><Icon name="pen" :size="16" /> {{ t('nav.newMessage') }}</a>

      <a href="#/recherche" class="nav-item" :aria-current="route === 'recherche' ? 'page' : undefined"><Icon name="search" :size="18" /> <span class="grow">{{ t('nav.search') }}</span></a>

      <nav class="nav-group" :aria-label="t('nav.triageGroup')">
        <span class="eyebrow nav-title">{{ t('nav.triageGroup') }}</span>
        <a href="#/tri" class="nav-item" :aria-current="route === 'tri' && filter === 'all' ? 'page' : undefined">
          <Icon name="sort" :size="18" /> <span class="grow">{{ t('nav.inbox') }}</span> <span class="count">{{ store.state?.emails.length ?? 0 }}</span>
        </a>
        <a v-for="k in CATS" :key="k" :href="`#/tri/${k}`" class="nav-item" :aria-current="route === 'tri' && filter === k ? 'page' : undefined">
          <span class="sq" :style="{ background: CAT_COLOR[k] }" aria-hidden="true" />
          <span class="grow">{{ t(`cat.${k}`) }}</span>
          <span :class="['count', { hot: k === 'reply' && counts.reply }]">{{ counts[k] }}</span>
        </a>
      </nav>

      <nav class="nav-group" :aria-label="t('nav.tools')">
        <span class="eyebrow nav-title">{{ t('nav.tools') }}</span>
        <a v-for="tool in tools" :key="tool.r" :href="`#/${tool.r}`" class="nav-item" :aria-current="route === tool.r ? 'page' : undefined">
          <Icon :name="tool.icon" :size="18" /> <span class="grow">{{ t(tool.label) }}</span>
        </a>
      </nav>

      <nav class="nav-group folders-nav" :aria-label="t('nav.folders')">
        <span class="eyebrow nav-title">{{ t('nav.folders') }}</span>
        <span v-if="!labels.length" class="muted" style="font-size: 13px; padding: 0 10px">—</span>
        <a
          v-for="l in labels"
          :key="l.id"
          :href="`#/dossiers/${encodeURIComponent(l.id)}`"
          class="nav-item small"
          :style="{ paddingLeft: `${10 + depth(l.name) * 14}px` }"
          :aria-current="route === 'dossiers' && loc.arg === l.id ? 'page' : undefined"
        >
          <Icon name="folder" :size="15" /> <span class="grow ellipsis">{{ l.name.split('/').pop() }}</span>
        </a>
      </nav>

      <div class="sidebar-foot">
        <QuotaGauge v-if="store.state?.gmail === 'connected'" />
        <a href="#/admin" class="nav-item" :aria-current="route === 'admin' ? 'page' : undefined">
          <span class="dot" :style="{ background: healthy ? 'var(--accent)' : 'var(--hot)' }" aria-hidden="true" />
          <span class="grow">{{ t('nav.admin') }}</span>
          <span class="muted" style="font-size: 12px">{{ healthy ? t('nav.adminOk') : t('nav.adminCheck') }}</span>
        </a>
        <span class="version mono">Calm {{ version }}</span>
      </div>
    </aside>

    <main class="main">
      <KeepAlive :include="KEPT">
      <Triage v-if="route === 'tri'" :filter="filter" />
      <Editor v-else-if="route === 'ecrire'" :key="draft.mailId ?? 'new'" />
      <Cleanup v-else-if="route === 'menage'" />
      <Newsletters v-else-if="route === 'desabonnements'" />
      <Agenda v-else-if="route === 'agenda'" />
      <Folders v-else-if="route === 'dossiers'" :label-id="loc.arg" />
      <Admin v-else-if="route === 'admin'" />
      <Search v-else-if="route === 'recherche'" :initial="loc.arg" />
      <Reminders v-else-if="route === 'rappels'" />
      </KeepAlive>
    </main>


    <header class="appbar">
      <span class="appbar-brand">Calm<span class="wordmark-dot">.</span></span>
      <button type="button" class="appbar-menu" :aria-label="t('nav.menu')" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen"><Icon name="menu" :size="20" /></button>
    </header>
    <div v-if="menuOpen" class="appmenu-backdrop" @click.self="menuOpen = false">
      <nav class="appmenu rise" :aria-label="t('nav.menu')">
        <div class="appmenu-who">
          <span class="appmenu-avatar" aria-hidden="true">{{ initial }}</span>
          <span class="appmenu-id">
            <b>{{ account?.name || account?.email || 'Calm' }}</b>
            <span v-if="account?.email && account?.name" class="muted">{{ account.email }}</span>
          </span>
        </div>
        <a href="#/admin" class="appmenu-item"><Icon name="gear" :size="18" /> <span class="grow">{{ t('nav.settings') }}</span><span class="dot" :style="{ background: healthy ? 'var(--accent)' : 'var(--hot)' }" aria-hidden="true" /></a>
        <a href="#/menage" class="appmenu-item"><Icon name="trash" :size="18" /> <span class="grow">{{ t('nav.cleanup') }}</span></a>
        <a href="#/desabonnements" class="appmenu-item"><Icon name="unsub" :size="18" /> <span class="grow">{{ t('nav.unsubscribe') }}</span></a>
        <a href="#/ecrire" class="appmenu-item" @click="draft = {}"><Icon name="pen" :size="18" /> <span class="grow">{{ t('nav.newMessage') }}</span></a>
        <span class="appmenu-version mono">Calm {{ version }}</span>
      </nav>
    </div>

    <nav ref="tabbarEl" :class="['tabbar', { mini: mini && onTab }]" :style="glassStyle" :aria-label="t('nav.tabs')">
      <GlassLayer :pill="pillEl" :dark="dark" :moving="pillMoves" />
      <span ref="pillEl" class="tab-pill" aria-hidden="true" :style="{ transform: `translate(${pillBox.x}px, ${pillBox.y}px)`, width: `${pillBox.w}px`, height: `${pillBox.h}px`, opacity: pillBox.w ? 1 : 0 }" />
      <a v-for="[r, label, icon] in tabs" :key="r" ref="tabEls" :href="`#/${r}`" :aria-current="route === r ? 'page' : undefined" @click="unfold($event, r)"><Icon :name="icon" :size="22" /> <span class="tab-label">{{ t(label) }}</span></a>
    </nav>
    <a v-if="mini && onTab && route !== 'recherche'" href="#/recherche" class="orb" :aria-label="t('nav.searchTab')">
      <GlassLayer :dark="dark" />
      <Icon name="search" :size="22" />
    </a>

    <PairRequests v-if="onComputer" />
    <div v-if="store.toast" :class="['toast', { err: store.toast.err }]" role="status">
      {{ store.toast.text }}
      <button v-if="store.toast.action" type="button" class="toast-act" @click="runToastAction">{{ store.toast.action.label }}</button>
    </div>
  </div>
</template>
