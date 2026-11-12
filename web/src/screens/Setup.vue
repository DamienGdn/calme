<script setup lang="ts">
import LogoMark from '../components/LogoMark.vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, post } from '../api.ts';
import Icon from '../components/Icon.vue';
import { setLang, type Lang } from '../i18n.ts';
import { goTo, notify, notifyError, refresh } from '../store.ts';

interface SetupState {
  claude: { installed: boolean; version: string | null };
  credentials: boolean;
  gmail: boolean;
  account: string | null;
  local: boolean;
  settings: { language: Lang; model: string; intervalMin: number; archiveMonths: number };
  done: boolean;
}

const { t, locale } = useI18n();
const s = ref<SetupState | null>(null);
const step = ref(0);
const test = ref<{ ok: boolean; ms: number; error?: string } | 'running' | null>(null);
const uploading = ref(false);
const STEPS = ['claude', 'google', 'prefs', 'done'] as const;

async function load() {
  try {
    s.value = await api<SetupState>('/api/setup');
  } catch (e) {
    notifyError(e);
  }
}
onMounted(async () => {
  await load();
  // Resume where the user left off (e.g. coming back from the Google consent page).
  if (s.value?.claude.installed) step.value = s.value.gmail ? 2 : 1;
});

const canNext = computed(() => {
  if (!s.value) return false;
  if (step.value === 0) return s.value.claude.installed && (test.value === null || test.value === 'running' || test.value.ok);
  if (step.value === 1) return s.value.gmail;
  return true;
});

async function runTest() {
  test.value = 'running';
  test.value = await post<{ ok: boolean; ms: number; error?: string }>('/api/admin/claude-test').catch((e) => ({ ok: false, ms: 0, error: (e as Error).message }));
}

async function upload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  uploading.value = true;
  try {
    const json = JSON.parse(await file.text());
    await api('/api/setup/credentials', { method: 'POST', body: JSON.stringify(json) });
    notify(t('setup.google.uploaded'));
    await load();
  } catch (err) {
    notifyError(err instanceof SyntaxError ? new Error(t('setup.google.notJson')) : err);
  } finally {
    uploading.value = false;
    (e.target as HTMLInputElement).value = '';
  }
}

async function savePref(patch: Partial<SetupState['settings']>) {
  try {
    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(patch) });
    if (patch.language) setLang(patch.language);
    await load();
  } catch (e) {
    notifyError(e);
  }
}

// While waiting for Google (consent happens in the browser), check every 3 s and move on by itself.
let waitTimer = 0;
watch(step, (st) => {
  window.clearInterval(waitTimer);
  if (st !== 1) return;
  waitTimer = window.setInterval(async () => {
    await load();
    if (s.value?.gmail) {
      window.clearInterval(waitTimer);
      notify(t('setup.google.connected', { account: s.value.account ?? '' }));
      step.value = 2;
    }
  }, 3000);
});
onBeforeUnmount(() => window.clearInterval(waitTimer));

async function finish() {
  await post('/api/setup/complete');
  await refresh();
  goTo('tri');
}
</script>

<template>
  <div class="setup">
    <header class="setup-head">
      <div class="brand">
        <span class="logo" aria-hidden="true"><LogoMark /></span>
        <span class="wordmark">Calm<span class="wordmark-dot">.</span></span>
      </div>
      <select class="select" :value="locale" :aria-label="t('common.language')" @change="savePref({ language: ($event.target as HTMLSelectElement).value as Lang })">
        <option value="fr">Français</option>
        <option value="en">English</option>
      </select>
    </header>

    <ol class="steps" :aria-label="t('setup.progress')">
      <li v-for="(k, i) in STEPS" :key="k" :class="{ active: i === step, done: i < step }" :aria-current="i === step ? 'step' : undefined">
        <span class="mono">{{ String(i + 1).padStart(2, '0') }}</span> {{ t(`setup.steps.${k}`) }}
      </li>
    </ol>

    <p v-if="!s" class="empty">{{ t('common.loading') }}</p>

    <section v-else class="setup-card rise" :key="step">
      <!-- 1 · Claude Code -->
      <template v-if="step === 0">
        <h1 class="headline" style="font-size: 40px">{{ t('setup.claude.title') }} <em>{{ t('setup.claude.em') }}</em></h1>
        <p class="lead">{{ t('setup.claude.intro') }}</p>
        <div :class="['check', s.claude.installed ? 'ok' : 'ko']">
          <span class="dot" aria-hidden="true" />
          <span>{{ s.claude.installed ? t('setup.claude.found', { v: s.claude.version }) : t('setup.claude.missing') }}</span>
        </div>
        <template v-if="!s.claude.installed">
          <p>{{ t('setup.claude.install') }}</p>
          <pre class="code">curl -fsSL https://claude.ai/install.sh | bash
claude   # {{ t('setup.claude.login') }}</pre>
          <p class="muted" style="font-size: 13px">{{ t('setup.claude.windows') }}</p>
        </template>
        <div v-else style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px">
          <button type="button" class="btn" :disabled="test === 'running'" @click="runTest">{{ test === 'running' ? t('admin.testing') : t('admin.test') }}</button>
          <span v-if="test && test !== 'running'" :class="['status', test.ok ? 'ok' : 'ko']">
            <span class="dot" aria-hidden="true" /> {{ test.ok ? t('admin.testOk', { s: (test.ms / 1000).toFixed(1) }) : test.error || t('admin.testKo') }}
          </span>
        </div>
        <p v-if="test && test !== 'running' && !test.ok" class="muted" style="font-size: 13px">{{ t('setup.claude.notLogged') }}</p>
        <button type="button" class="btn" style="align-self: flex-start" @click="load"><Icon name="refresh" :size="16" /> {{ t('setup.recheck') }}</button>
      </template>

      <!-- 2 · Gmail + Calendar -->
      <template v-else-if="step === 1">
        <h1 class="headline" style="font-size: 40px">{{ t('setup.google.title') }} <em>{{ t('setup.google.em') }}</em></h1>
        <p class="lead">{{ t('setup.google.intro') }}</p>
        <div :class="['check', s.credentials ? 'ok' : 'ko']"><span class="dot" aria-hidden="true" /> {{ s.credentials ? t('setup.google.hasFile') : t('setup.google.noFile') }}</div>
        <div :class="['check', s.gmail ? 'ok' : 'ko']"><span class="dot" aria-hidden="true" /> {{ s.gmail ? t('setup.google.connected', { account: s.account ?? '' }) : t('setup.google.notConnected') }}</div>

        <ol v-if="!s.credentials" class="howto">
          <li>
            <i18n-t keypath="setup.google.s1" tag="span"><template #link><a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener noreferrer">console.cloud.google.com</a></template></i18n-t>
          </li>
          <li>
            <i18n-t keypath="setup.google.s2" tag="span">
              <template #gmail><a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noopener noreferrer">Gmail API</a></template>
              <template #calendar><a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noopener noreferrer">Google Calendar API</a></template>
            </i18n-t>
          </li>
          <li>
            <i18n-t keypath="setup.google.s3" tag="span"><template #link><a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noopener noreferrer">Google Auth Platform</a></template></i18n-t>
          </li>
          <li>{{ t('setup.google.s4') }}</li>
          <li>
            <i18n-t keypath="setup.google.s5" tag="span"><template #link><a href="https://console.cloud.google.com/auth/clients/create" target="_blank" rel="noopener noreferrer">{{ t('setup.google.clients') }}</a></template></i18n-t>
          </li>
        </ol>

        <template v-if="!s.credentials">
          <label v-if="s.local" class="dropzone" style="min-height: 72px">
            <input type="file" accept="application/json,.json" class="sr" @change="upload" />
            <Icon name="clip" :size="18" /> {{ uploading ? t('common.loading') : t('setup.google.drop') }}
          </label>
          <p v-else class="banner"><span>{{ t('setup.google.onlyLocal') }}</span></p>
        </template>

        <template v-else-if="!s.gmail">
          <a v-if="s.local" class="btn btn-prim" href="/auth/google" target="_blank" rel="opener" style="align-self: flex-start">{{ t('setup.google.connect') }}</a>
          <p v-if="s.local" class="muted" style="font-size: 13px">{{ t('setup.google.waiting') }}</p>
          <p v-else class="banner"><span>{{ t('setup.google.onlyLocal') }}</span></p>
          <p class="muted" style="font-size: 13px; line-height: 1.6">{{ t('setup.google.unverified') }}</p>
        </template>
        <button type="button" class="btn" style="align-self: flex-start" @click="load"><Icon name="refresh" :size="16" /> {{ t('setup.recheck') }}</button>
      </template>

      <!-- 3 · Preferences -->
      <template v-else-if="step === 2">
        <h1 class="headline" style="font-size: 40px">{{ t('setup.prefs.title') }} <em>{{ t('setup.prefs.em') }}</em></h1>
        <div class="form-grid" style="max-width: 760px">
          <label>
            <span class="eyebrow">{{ t('admin.language') }}</span>
            <select class="select" :value="s.settings.language" @change="savePref({ language: ($event.target as HTMLSelectElement).value as Lang })">
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            <span class="eyebrow">{{ t('admin.model') }}</span>
            <select class="select" :value="s.settings.model" @change="savePref({ model: ($event.target as HTMLSelectElement).value })">
              <option v-for="m in ['haiku', 'sonnet', 'opus']" :key="m" :value="m">{{ t(`admin.models.${m}`) }}</option>
            </select>
          </label>
          <label>
            <span class="eyebrow">{{ t('admin.frequency') }}</span>
            <select class="select" :value="s.settings.intervalMin" @change="savePref({ intervalMin: Number(($event.target as HTMLSelectElement).value) })">
              <option v-for="m in [2, 5, 10, 15, 30, 60]" :key="m" :value="m">{{ t('admin.every', { n: m }) }}</option>
            </select>
          </label>
          <label>
            <span class="eyebrow">{{ t('admin.depth') }}</span>
            <select class="select" :value="s.settings.archiveMonths" @change="savePref({ archiveMonths: Number(($event.target as HTMLSelectElement).value) })">
              <option :value="0">{{ t('admin.recentOnly') }}</option>
              <option v-for="m in [1, 3, 6, 12, 24, 36]" :key="m" :value="m">{{ t('admin.months', { n: m }) }}</option>
            </select>
          </label>
        </div>
        <p class="muted" style="font-size: 13px; line-height: 1.6; max-width: 70ch">{{ t('setup.prefs.note') }}</p>
      </template>

      <!-- 4 · Done -->
      <template v-else>
        <h1 class="headline" style="font-size: 40px">{{ t('setup.done.title') }} <em>{{ t('setup.done.em') }}</em></h1>
        <ul class="summary">
          <li><span class="dot" aria-hidden="true" /> {{ t('setup.claude.found', { v: s.claude.version }) }}</li>
          <li><span class="dot" aria-hidden="true" /> {{ t('setup.google.connected', { account: s.account ?? '' }) }}</li>
          <li><span class="dot" aria-hidden="true" /> {{ t('setup.done.first') }}</li>
        </ul>
        <p class="muted" style="font-size: 13px; line-height: 1.6; max-width: 70ch">{{ t('setup.done.iphone') }}</p>
      </template>

      <footer class="setup-foot">
        <button v-if="step > 0" type="button" class="btn" @click="step--"><Icon name="back" :size="16" /> {{ t('common.back') }}</button>
        <span style="flex: 1" />
        <button v-if="step < 3" type="button" class="btn btn-prim" :disabled="!canNext" @click="step++">{{ t('setup.next') }} <Icon name="arrow" :size="16" /></button>
        <button v-else type="button" class="btn btn-prim" @click="finish">{{ t('setup.start') }} <Icon name="arrow" :size="16" /></button>
      </footer>
    </section>
  </div>
</template>
