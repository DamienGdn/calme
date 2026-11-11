<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, post, when } from '../api.ts';
import { notify, notifyError } from '../store.ts';

/** Daily automatic backups of the database, manual backup and restore (restore only from the computer). */
const props = defineProps<{ local: boolean }>();
const { t } = useI18n();
const b = ref<{ dir: string | null; backups: { name: string; size: number; date: number }[]; last: number | null } | null>(null);
const busy = ref(false);
const confirmName = ref<string | null>(null);

const load = () => api<typeof b.value>('/api/backup').then((v) => (b.value = v)).catch(notifyError);
onMounted(load);
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

async function now() {
  busy.value = true;
  try {
    await post('/api/backup/now');
    notify(t('backup.done'));
    await load();
  } catch (e) {
    notifyError(e);
  } finally {
    busy.value = false;
  }
}
async function restore(name: string) {
  try {
    await post('/api/backup/restore', { name });
    notify(t('backup.restoring'));
    confirmName.value = null;
    setTimeout(() => location.reload(), 4000);
  } catch (e) {
    notifyError(e);
  }
}
</script>

<template>
  <section class="card" aria-labelledby="a-backup">
    <h2 id="a-backup">{{ t('backup.title') }}</h2>
    <span :class="['status', b?.last ? 'ok' : 'ko']"><span class="dot" aria-hidden="true" /> {{ b?.last ? t('backup.last', { when: when(b.last) }) : t('backup.never') }}</span>
    <dl class="kv">
      <dt>{{ t('backup.where') }}</dt>
      <dd class="mono" style="font-size: 12px">{{ b?.dir ?? '—' }}</dd>
    </dl>
    <div style="display: flex; flex-direction: column; gap: 6px">
      <div v-for="x in b?.backups ?? []" :key="x.name" class="device">
        <span style="flex: 1" class="mono">{{ x.name.slice(6, 16) }} <span class="muted">· {{ mb(x.size) }}</span></span>
        <template v-if="props.local">
          <button v-if="confirmName !== x.name" type="button" class="btn" style="min-height: 34px; padding: 0 10px; font-size: 12px" @click="confirmName = x.name">{{ t('backup.restore') }}</button>
          <button v-else type="button" class="btn btn-danger" style="min-height: 34px; padding: 0 10px; font-size: 12px" @click="restore(x.name)">{{ t('backup.confirm') }}</button>
        </template>
      </div>
    </div>
    <p v-if="confirmName" style="margin: 0; font-size: 12px; color: var(--hot-text); line-height: 1.5">{{ t('backup.warning') }}</p>
    <button type="button" class="btn btn-prim" :disabled="busy" style="align-self: flex-start" @click="now">{{ t('backup.now') }}</button>
    <p class="muted" style="margin: 0; font-size: 12px; line-height: 1.5; margin-top: auto">{{ t('backup.note') }}</p>
  </section>
</template>
