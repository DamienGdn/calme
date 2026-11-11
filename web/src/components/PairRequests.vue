<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, post } from '../api.ts';
import { notifyError } from '../store.ts';

/** On the computer running Calm: a screen (e.g. the iPhone home-screen app) asks for access; allow or refuse here. */
const { t } = useI18n();
const pending = ref<{ id: string; name: string }[]>([]);
const load = () => api<typeof pending.value>('/api/pair/requests').then((v) => (pending.value = v)).catch(() => {});
let timer = 0;
onMounted(() => {
  void load();
  timer = window.setInterval(load, 3000);
});
onBeforeUnmount(() => window.clearInterval(timer));

async function decide(id: string, approve: boolean) {
  try {
    await post(`/api/pair/requests/${encodeURIComponent(id)}`, { approve });
  } catch (e) {
    notifyError(e);
  }
  await load();
}
</script>

<template>
  <div v-if="pending[0]" class="pair-req" role="alertdialog" aria-live="assertive">
    <strong>{{ t('pairReq.title', { name: pending[0].name }) }}</strong>
    <p>{{ t('pairReq.note') }}</p>
    <button type="button" class="btn btn-prim" @click="decide(pending[0].id, true)">{{ t('pairReq.allow') }}</button>
    <button type="button" class="btn" @click="decide(pending[0].id, false)">{{ t('pairReq.deny') }}</button>
  </div>
</template>
