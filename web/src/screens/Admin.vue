<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, post, when, type Category } from '../api.ts';
import Icon from '../components/Icon.vue';
import BackupCard from '../components/BackupCard.vue';
import IphoneCard from '../components/IphoneCard.vue';
import NotificationsCard from '../components/NotificationsCard.vue';
import SignatureCard from '../components/SignatureCard.vue';
import CalendarsCard from '../components/CalendarsCard.vue';
import QuotaGauge from '../components/QuotaGauge.vue';
import { canRefract } from '../glass.ts';
import { dateLocale, setLang, type Lang } from '../i18n.ts';
import { GLASS_DEFAULT, GLASS_MAX, notify, notifyError, refresh, setGlass, setThemePref, store, syncNow, type Glass, type ThemePref } from '../store.ts';

const version = __APP_VERSION__;
const THEMES: ThemePref[] = ['system', 'light', 'dark'];
const refracts = canRefract(navigator.userAgent);
/** Refraction, depth and aberration only show where the browser can bend the backdrop (not on iPhone). */
const GLASS_KNOBS = ([
  { key: 'strength', unit: ' px', refract: true },
  { key: 'depth', unit: ' px', refract: true },
  { key: 'aberration', unit: ' px', refract: true },
  { key: 'blur', unit: ' px', refract: false },
  { key: 'tint', unit: ' %', refract: false },
] as { key: keyof Glass; unit: string; refract: boolean }[]).filter((k) => !k.refract || refracts);

interface Settings {
  autoUnsubscribe: boolean;
  keepSenders: string[];
  archiveMonths: number;
  model: string;
  intervalMin: number;
  language: Lang;
  pushMode: 'all' | 'reply' | 'off';
  quietStart: number | null;
  quietEnd: number | null;
  remoteImages: boolean;
  signature: string;
  signatureOn: boolean;
  hiddenCalendars: string[];
}
interface AdminView {
  claude: { installed: boolean; version: string | null };
  google: { hasCredentials: boolean; connected: boolean; account: string | null; scopes: string[] };
  settings: Settings;
  lastSync: number | null;
  lastTriage: number | null;
  running: boolean;
  error: string | null;
  counts: Record<Category, number>;
  analyzing: number;
  pushDevices: number;
  unsubscribed: number;
  archive: { count: number; oldest: number | null; done: boolean } | null;
  home: string;
  port: number;
}

const { t, locale } = useI18n();
const v = ref<AdminView | null>(null);
const test = ref<{ ok: boolean; ms: number; error?: string } | 'running' | null>(null);
const keep = ref('');
// Restore and Tailscale changes are only allowed from the computer running Calm.
const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
const SCOPE_KEY: Record<string, string> = {
  'https://www.googleapis.com/auth/gmail.modify': 'admin.scope.modify',
  'https://www.googleapis.com/auth/gmail.send': 'admin.scope.send',
  'https://www.googleapis.com/auth/calendar.events': 'admin.scope.calendar',
};
const CATS: Category[] = ['reply', 'read', 'news', 'trash'];

async function load() {
  try {
    v.value = await api<AdminView>('/api/admin');
    keep.value = v.value.settings.keepSenders.join('\n');
  } catch (e) {
    notifyError(e);
  }
}
onMounted(load);

async function save(patch: Partial<Settings> | Record<string, unknown>, msg = t('admin.saved')) {
  try {
    const settings = await api<Settings>('/api/admin/settings', { method: 'PUT', body: JSON.stringify(patch) });
    if (v.value) v.value.settings = settings;
    notify(msg);
    void refresh();
  } catch (e) {
    notifyError(e);
  }
}

async function changeLang(lang: Lang) {
  setLang(lang);
  await save({ language: lang });
  void refresh();
}

async function runTest() {
  test.value = 'running';
  test.value = await post<{ ok: boolean; ms: number; error?: string }>('/api/admin/claude-test').catch((e) => ({ ok: false, ms: 0, error: (e as Error).message }));
}

async function sync() {
  await syncNow().catch(() => {});
  notify(t('common.syncStarted'));
  window.setTimeout(() => void load(), 2000);
}


const healthy = computed(() => Boolean(v.value?.claude.installed && v.value.google.connected && !v.value.error));
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
</script>

<template>
  <p v-if="!v" class="empty">{{ t('common.loading') }}</p>
  <template v-else>
    <header class="topbar">
      <span class="eyebrow">{{ t('admin.eyebrow') }}</span>
      <a class="btn" href="#/installation">{{ t('admin.rerunSetup') }}</a>
      <button type="button" class="btn" @click="load"><Icon name="refresh" :size="16" /> {{ t('common.refresh') }}</button>
    </header>

    <h1 class="headline">
      <template v-if="healthy">{{ t('admin.allGood') }} <em>{{ t('admin.allGoodEm') }}</em></template>
      <template v-else><span class="hot">{{ t('admin.check') }}</span> {{ t('admin.checkRest') }} <em>{{ t('admin.checkEm') }}</em></template>
    </h1>

    <div class="cards-wrap"><div class="grid-cards">
      <section class="card" aria-labelledby="a-claude">
        <h2 id="a-claude">{{ t('admin.engine') }}</h2>
        <span :class="['status', v.claude.installed ? 'ok' : 'ko']"><span class="dot" aria-hidden="true" /> {{ v.claude.installed ? t('admin.installed') : t('admin.notFound') }}</span>
        <dl class="kv">
          <dt>{{ t('admin.version') }}</dt>
          <dd class="mono">{{ v.claude.version ?? '—' }}</dd>
          <dt>{{ t('admin.model') }}</dt>
          <dd>
            <select class="select" :value="v.settings.model" :aria-label="t('admin.model')" @change="save({ model: ($event.target as HTMLSelectElement).value })">
              <option v-for="m in ['haiku', 'sonnet', 'opus']" :key="m" :value="m">{{ t(`admin.models.${m}`) }}</option>
            </select>
          </dd>
          <dt>{{ t('admin.lastTriage') }}</dt>
          <dd>{{ v.lastTriage ? when(v.lastTriage) : '—' }}</dd>
          <dt>{{ t('admin.pending') }}</dt>
          <dd>{{ t('common.mails', v.analyzing) }}</dd>
        </dl>
        <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px">
          <button type="button" class="btn btn-prim" :disabled="test === 'running'" @click="runTest">{{ test === 'running' ? t('admin.testing') : t('admin.test') }}</button>
          <span v-if="test && test !== 'running'" :class="['status', test.ok ? 'ok' : 'ko']" style="font-size: 13px">
            <span class="dot" aria-hidden="true" /> {{ test.ok ? t('admin.testOk', { s: (test.ms / 1000).toFixed(1) }) : test.error || t('admin.testKo') }}
          </span>
        </div>
        <i18n-t keypath="admin.engineNote" tag="p" class="muted" style="margin: 0; font-size: 12px; line-height: 1.5">
          <template #cmd><code class="mono">claude -p</code></template>
        </i18n-t>
      </section>

      <section class="card" aria-labelledby="a-google">
        <h2 id="a-google">{{ t('admin.google') }}</h2>
        <span :class="['status', v.google.connected ? 'ok' : 'ko']">
          <span class="dot" aria-hidden="true" /> {{ v.google.connected ? t('admin.connected') : v.google.hasCredentials ? t('admin.disconnected') : t('admin.noCredentials') }}
        </span>
        <dl class="kv">
          <dt>{{ t('admin.account') }}</dt>
          <dd>{{ v.google.account ?? '—' }}</dd>
          <dt>{{ t('admin.scopes') }}</dt>
          <dd>
            <ul style="margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px">
              <li v-for="sc in v.google.scopes" :key="sc">{{ SCOPE_KEY[sc] ? t(SCOPE_KEY[sc]) : sc }}</li>
            </ul>
          </dd>
        </dl>
        <a class="btn" href="/auth/google" target="_blank" rel="opener" style="align-self: flex-start">{{ t('admin.reconnect') }}</a>
      </section>

      <section class="card" aria-labelledby="a-app">
        <h2 id="a-app">{{ t('admin.app') }}</h2>
        <span class="status ok"><span class="dot" aria-hidden="true" /> Calm <span class="mono">{{ version }}</span></span>
        <div style="display: flex; flex-direction: column; gap: 6px">
          <span id="a-theme" class="eyebrow">{{ t('admin.theme') }}</span>
          <div class="tones" role="radiogroup" aria-labelledby="a-theme" style="align-self: flex-start; max-width: 100%">
            <button v-for="th in THEMES" :key="th" type="button" role="radio" :aria-checked="store.themePref === th" @click="setThemePref(th)">{{ t(`admin.themes.${th}`) }}</button>
          </div>
          <span class="muted" style="font-size: 12px">{{ t('admin.themeNote') }}</span>
        </div>
        <div class="glass-set">
          <span class="eyebrow">{{ t('admin.glass') }}</span>
          <label v-for="k in GLASS_KNOBS" :key="k.key" class="range">
            <span>{{ t(`admin.glassKnobs.${k.key}`) }}</span>
            <input type="range" min="0" :max="GLASS_MAX[k.key]" :value="store.glass[k.key]" @input="setGlass({ [k.key]: Number(($event.target as HTMLInputElement).value) })" />
            <output class="mono">{{ store.glass[k.key] }}{{ k.unit }}</output>
          </label>
          <span class="muted" style="font-size: 12px">{{ t(refracts ? 'admin.glassNote' : 'admin.glassNoteFrosted') }} <button type="button" class="linkish" style="display: inline; padding: 0" @click="setGlass(GLASS_DEFAULT)">{{ t('admin.glassReset') }}</button></span>
        </div>
        <label class="switch">
          <input type="checkbox" :checked="v.settings.remoteImages" @change="save({ remoteImages: ($event.target as HTMLInputElement).checked })" />
          {{ t('admin.remoteImages') }}
        </label>
        <span class="muted" style="font-size: 12px; margin-top: -6px">{{ t('admin.remoteImagesNote') }}</span>
        <label style="display: flex; flex-direction: column; gap: 6px">
          <span class="eyebrow">{{ t('admin.language') }}</span>
          <select class="select" :value="locale" @change="changeLang(($event.target as HTMLSelectElement).value as Lang)">
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
          <span class="muted" style="font-size: 12px">{{ t('admin.languageNote') }}</span>
        </label>
        <a class="muted" href="https://github.com/DamienGdn/calme/releases" target="_blank" rel="noopener noreferrer" style="margin-top: auto; font-size: 12px">{{ t('admin.releases') }}</a>
      </section>

      <section class="card" aria-labelledby="a-sync">
        <h2 id="a-sync">{{ t('admin.sync') }}</h2>
        <span :class="['status', v.error ? 'ko' : 'ok']"><span class="dot" aria-hidden="true" /> {{ v.running ? t('admin.syncRunning') : v.error ? t('admin.syncFailed') : 'OK' }}</span>
        <p v-if="v.error" style="margin: 0; font-size: 13px; color: var(--danger)">{{ v.error }}</p>
        <dl class="kv">
          <dt>{{ t('admin.lastSync') }}</dt>
          <dd>{{ v.lastSync ? when(v.lastSync) : t('admin.never') }}</dd>
          <dt>{{ t('admin.frequency') }}</dt>
          <dd>
            <select class="select" :value="v.settings.intervalMin" :aria-label="t('admin.frequency')" @change="save({ intervalMin: Number(($event.target as HTMLSelectElement).value) })">
              <option v-for="m in [0.5, 1, 2, 5, 10, 15, 30, 60]" :key="m" :value="m">{{ m < 1 ? t('admin.everySec', { n: m * 60 }) : t('admin.every', { n: m }) }}</option>
            </select>
          </dd>
          <dt>{{ t('admin.box') }}</dt>
          <dd>{{ CATS.map((k) => `${t(`cat.${k}`)} ${v!.counts[k]}`).join(' · ') }}</dd>
        </dl>
        <QuotaGauge />
        <p class="muted" style="margin: 0; font-size: 12px; line-height: 1.5">{{ t('admin.quotaNote') }}</p>
        <button type="button" class="btn btn-prim" style="align-self: flex-start" @click="sync"><Icon name="refresh" :size="16" /> {{ t('admin.syncNow') }}</button>
      </section>

      <section class="card" aria-labelledby="a-archive">
        <h2 id="a-archive">{{ t('admin.archive') }}</h2>
        <span :class="['status', v.archive?.done ? 'ok' : 'ko']"><span class="dot" aria-hidden="true" /> {{ v.archive?.done ? t('admin.upToDate') : t('admin.filling') }}</span>
        <dl class="kv">
          <dt>{{ t('admin.stored') }}</dt>
          <dd>{{ (v.archive?.count ?? 0).toLocaleString(dateLocale()) }}</dd>
          <dt>{{ t('admin.oldest') }}</dt>
          <dd>{{ v.archive?.oldest ? fmtDate(v.archive.oldest) : '—' }}</dd>
          <dt>{{ t('admin.depth') }}</dt>
          <dd>
            <select class="select" :value="v.settings.archiveMonths" :aria-label="t('admin.depth')" @change="save({ archiveMonths: Number(($event.target as HTMLSelectElement).value) })">
              <option :value="0">{{ t('admin.recentOnly') }}</option>
              <option v-for="m in [1, 3, 6, 12, 24, 36]" :key="m" :value="m">{{ t('admin.months', { n: m }) }}</option>
            </select>
          </dd>
        </dl>
        <p class="muted" style="margin: 0; font-size: 12px; line-height: 1.5">{{ t('admin.archiveNote') }}</p>
      </section>

      <section class="card" aria-labelledby="a-unsub">
        <h2 id="a-unsub">{{ t('admin.autoUnsub') }}</h2>
        <label class="switch">
          <input type="checkbox" :checked="v.settings.autoUnsubscribe" @change="save({ autoUnsubscribe: ($event.target as HTMLInputElement).checked })" />
          {{ t('admin.autoUnsubLabel') }}
        </label>
        <p class="muted" style="margin: 0; font-size: 13px; line-height: 1.5">{{ t('admin.autoUnsubNote', { n: v.unsubscribed }) }}</p>
        <label for="keep" class="eyebrow">{{ t('admin.keepList') }}</label>
        <textarea id="keep" v-model="keep" class="plain" placeholder="newsletter@example.com" />
        <button type="button" class="btn" style="align-self: flex-start" @click="save({ keepSenders: keep.split(/[\s,;]+/) }, t('admin.listSaved'))">{{ t('admin.saveList') }}</button>
      </section>

      <CalendarsCard :hidden="v.settings.hiddenCalendars" @save="save" />
      <SignatureCard :signature="v.settings.signature" :on="v.settings.signatureOn" @save="save" />
      <BackupCard :local="local" />
      <NotificationsCard :push-mode="v.settings.pushMode" :quiet-start="v.settings.quietStart" :quiet-end="v.settings.quietEnd" @save="save" />
      <IphoneCard :local="local" :ai-ok="v.claude.installed" />

      <section class="card" aria-labelledby="a-data">
        <h2 id="a-data">{{ t('admin.system') }}</h2>
        <dl class="kv">
          <dt>{{ t('admin.data') }}</dt>
          <dd class="mono">{{ v.home }}</dd>
          <dt>{{ t('admin.localUrl') }}</dt>
          <dd class="mono">http://127.0.0.1:{{ v.port }}</dd>
          <dt>{{ t('admin.iphone') }}</dt>
          <dd><code class="mono">tailscale serve --bg {{ v.port }}</code></dd>
          <dt>{{ t('admin.newToken') }}</dt>
          <dd>
            <i18n-t keypath="admin.newTokenHow" tag="span"><template #file><code class="mono">config.json</code></template></i18n-t>
          </dd>
        </dl>
      </section>
    </div></div>
  </template>
</template>
