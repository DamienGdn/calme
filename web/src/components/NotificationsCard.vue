<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, post } from '../api.ts';
import { dateLocale } from '../i18n.ts';
import { badgeStatus, enablePush, pushSupported, testBadge } from '../push.ts';
import { notify, notifyError, store } from '../store.ts';
import { isUnread } from '../unread.ts';

/** Phone notifications: what to push, quiet hours, subscribed devices (test / remove). */
const props = defineProps<{ pushMode: 'all' | 'reply' | 'off'; quietStart: number | null; quietEnd: number | null }>();
const emit = defineEmits<{ save: [patch: Record<string, unknown>] }>();
const { t } = useI18n();
const devices = ref<{ endpoint: string; name: string; addedAt: number | null }[]>([]);
const canPush = pushSupported() && !window.calmeDesktop;
const isDesktop = Boolean(window.calmeDesktop);
const hours = Array.from({ length: 24 }, (_, h) => h);

const badge = ref(badgeStatus());
async function tryBadge() {
  const n = (store.state?.emails ?? []).filter(isUnread).length;
  try {
    await testBadge(n || 1);
    notify(t('badge.tested', { n: n || 1 }));
  } catch (e) {
    notifyError(e);
  } finally {
    badge.value = badgeStatus();
  }
}

const load = () => api<typeof devices.value>('/api/push/devices').then((d) => (devices.value = d)).catch(() => {});
onMounted(load);

async function testDevice(endpoint: string) {
  try {
    const r = await post<{ ok: boolean }>('/api/push/test', { endpoint });
    notify(r.ok ? t('notif.testSent') : t('notif.testFailed'), !r.ok);
  } catch (e) {
    notifyError(e);
  }
}
async function remove(endpoint: string) {
  await post('/api/push/devices/remove', { endpoint }).catch(notifyError);
  await load();
}
async function here() {
  try {
    await enablePush();
    notify(t('triage.pushOn'));
    await load();
  } catch (e) {
    notifyError(e);
  }
}
const setQuiet = (on: boolean) => emit('save', on ? { quietStart: 22, quietEnd: 7 } : { quietStart: null, quietEnd: null });
</script>

<template>
  <section class="card" aria-labelledby="a-devices">
    <h2 id="a-devices">{{ t('admin.notifications') }}</h2>
    <label style="display: flex; flex-direction: column; gap: 6px">
      <span class="eyebrow">{{ t('notif.what') }}</span>
      <select class="select" :value="props.pushMode" @change="emit('save', { pushMode: ($event.target as HTMLSelectElement).value })">
        <option value="all">{{ t('notif.all') }}</option>
        <option value="reply">{{ t('notif.reply') }}</option>
        <option value="off">{{ t('notif.off') }}</option>
      </select>
    </label>
    <label class="switch">
      <input type="checkbox" :checked="props.quietStart !== null" @change="setQuiet(($event.target as HTMLInputElement).checked)" />
      {{ t('notif.quiet') }}
    </label>
    <div v-if="props.quietStart !== null" style="display: flex; align-items: center; gap: 8px; font-size: 14px">
      {{ t('notif.from') }}
      <select class="select" :value="props.quietStart" @change="emit('save', { quietStart: Number(($event.target as HTMLSelectElement).value) })">
        <option v-for="h in hours" :key="h" :value="h">{{ h }} h</option>
      </select>
      {{ t('notif.to') }}
      <select class="select" :value="props.quietEnd ?? 7" @change="emit('save', { quietEnd: Number(($event.target as HTMLSelectElement).value) })">
        <option v-for="h in hours" :key="h" :value="h">{{ h }} h</option>
      </select>
    </div>
    <div style="display: flex; flex-direction: column; gap: 6px">
      <span class="eyebrow">{{ t('notif.devices') }}</span>
      <p v-if="!devices.length" class="muted" style="margin: 0; font-size: 13px">{{ t('notif.none') }}</p>
      <div v-for="d in devices" :key="d.endpoint" class="device">
        <span style="flex: 1">{{ d.name }}<span v-if="d.addedAt" class="muted" style="font-size: 12px"> · {{ new Date(d.addedAt).toLocaleDateString(dateLocale()) }}</span></span>
        <button type="button" class="btn" style="min-height: 34px; padding: 0 10px; font-size: 12px" @click="testDevice(d.endpoint)">{{ t('notif.test') }}</button>
        <button type="button" class="btn btn-danger" style="min-height: 34px; padding: 0 10px; font-size: 12px" :aria-label="t('common.remove', { name: d.name })" @click="remove(d.endpoint)">×</button>
      </div>
    </div>
    <button v-if="canPush" type="button" class="btn" style="align-self: flex-start" @click="here">{{ t('admin.enableHere') }}</button>
    <p class="muted" style="margin: 0; font-size: 12px; line-height: 1.5; margin-top: auto">{{ t('admin.notifNote') }}</p>
    <div v-if="!isDesktop" class="badge-check">
      <span class="eyebrow">{{ t('badge.title') }}</span>
      <ul>
        <li :class="badge.homeScreen ? 'ok' : 'ko'">{{ badge.homeScreen ? t('badge.homeOk') : t('badge.homeKo') }}</li>
        <li :class="badge.permission === 'granted' ? 'ok' : 'ko'">{{ badge.permission === 'granted' ? t('badge.permOk') : t('badge.permKo') }}</li>
        <li :class="badge.supported ? 'ok' : 'ko'">{{ badge.supported ? t('badge.apiOk') : t('badge.apiKo') }}</li>
      </ul>
      <p class="muted" style="margin: 0; font-size: 13px; line-height: 1.5">{{ t('badge.note') }}</p>
      <button type="button" class="btn" style="align-self: flex-start" @click="tryBadge">{{ t('badge.test') }}</button>
    </div>
  </section>
</template>
