<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ServerStatus } from '../api.ts';
import { dateLocale } from '../i18n.ts';
import { notifyError } from '../store.ts';

/**
 * Admin › Background server (Mac app only): the server can run as a macOS service, started with the Mac and kept
 * running when the app is quit, so the iPhone keeps working. Shows where it runs and whether it answers; turns the
 * service on or off, restarts the server. The page reloads after a switch (the server moved).
 */
const { t } = useI18n();
const desk = window.calmeDesktop;
const status = ref<ServerStatus | null>(null);
const busy = ref<'' | 'switch' | 'restart'>('');
let timer = 0;

async function load() {
  status.value = (await desk?.serverStatus?.().catch(() => null)) ?? null;
}
onMounted(() => {
  void load();
  timer = window.setInterval(load, 10_000);
});
onBeforeUnmount(() => window.clearInterval(timer));

async function run(kind: 'switch' | 'restart', job: () => Promise<ServerStatus | null> | undefined) {
  busy.value = kind;
  try {
    status.value = (await job()) ?? status.value;
    location.reload();
  } catch (e) {
    notifyError(e);
    busy.value = '';
    void load();
  }
}
const mb = (kb: number) => Math.round(kb / 1024).toLocaleString(dateLocale());
const toggle = (on: boolean) => run('switch', () => desk?.setBackground?.(on));
const restart = () => run('restart', () => desk?.restartServer?.());
</script>

<template>
  <section v-if="status?.available" class="card" aria-labelledby="a-background">
    <h2 id="a-background">{{ t('background.title') }}</h2>
    <p class="muted" style="margin: 0; font-size: 14px; line-height: 1.5">{{ t('background.lead') }}</p>
    <p class="bg-status" role="status">
      <span class="dot" :style="{ background: status.up ? 'var(--accent)' : 'var(--hot)' }" aria-hidden="true" />
      <span>
        <b>{{ status.up ? t('background.up') : t('background.down') }}</b>
        <span class="muted"> · {{ t(`background.mode.${status.mode}`) }}<template v-if="status.pid"> · pid {{ status.pid }}</template></span>
      </span>
    </p>
    <p v-if="status.memory" class="muted" style="margin: 0; font-size: 13px">
      {{ t('background.memory', { mb: mb(status.memory.rssKb), n: status.memory.processes }, status.memory.processes) }}
    </p>
    <label class="switch">
      <input type="checkbox" :checked="status.background" :disabled="Boolean(busy)" @change="toggle(($event.target as HTMLInputElement).checked)" />
      <span>{{ busy === 'switch' ? t('background.switching') : t('background.toggle') }}</span>
    </label>
    <span style="display: flex; flex-wrap: wrap; gap: 8px">
      <button type="button" :class="['btn', { 'btn-prim': !status.up }]" :disabled="Boolean(busy)" @click="restart">
        {{ busy === 'restart' ? t('background.restarting') : status.up ? t('background.restart') : t('background.start') }}
      </button>
    </span>
    <p class="muted" style="margin: 0; font-size: 12px; line-height: 1.5">{{ status.background ? t('background.noteOn') : t('background.noteOff') }}</p>
  </section>
</template>
