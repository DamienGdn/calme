<script setup lang="ts">
import QRCode from 'qrcode';
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, getToken, post } from '../api.ts';
import { notifyError } from '../store.ts';

/** Links the iPhone through Tailscale and pairs it with a QR code (URL + pairing token). */
defineProps<{ local: boolean; aiOk: boolean }>();
const { t } = useI18n();
const r = ref<{ installed: boolean; serving: boolean; url: string | null } | null>(null);
const busy = ref(false);
const qr = ref<string | null>(null);

const load = () => api<typeof r.value>('/api/remote').then((v) => (r.value = v)).catch(notifyError);
onMounted(load);

watch(r, async (v) => {
  qr.value = null;
  if (!v?.serving || !v.url) return;
  // The PWA reads #pair=<token> on first load and pairs itself.
  qr.value = await QRCode.toDataURL(`${v.url}/#pair=${getToken() ?? ''}`, { margin: 1, width: 220, color: { dark: '#0D0E11', light: '#EDEBE5' } });
});

async function enable() {
  busy.value = true;
  try {
    await post('/api/remote/enable');
    await load();
  } catch (e) {
    notifyError(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="card" aria-labelledby="a-iphone">
    <h2 id="a-iphone">{{ t('iphone.title') }}</h2>
    <p v-if="!r" class="muted">{{ t('common.loading') }}</p>
    <template v-else-if="!r.installed">
      <span class="status ko"><span class="dot" aria-hidden="true" /> {{ t('iphone.noTailscale') }}</span>
      <p class="muted" style="margin: 0; font-size: 13px; line-height: 1.6">{{ t('iphone.installTailscale') }}</p>
      <a class="btn" href="https://tailscale.com/download" target="_blank" rel="noopener noreferrer" style="align-self: flex-start">tailscale.com/download</a>
      <button type="button" class="btn" style="align-self: flex-start" @click="load">{{ t('setup.recheck') }}</button>
    </template>
    <template v-else-if="!r.serving">
      <span class="status ko"><span class="dot" aria-hidden="true" /> {{ t('iphone.notShared') }}</span>
      <p class="muted" style="margin: 0; font-size: 13px; line-height: 1.6">{{ t('iphone.shareNote') }}</p>
      <button v-if="local" type="button" class="btn btn-prim" :disabled="busy" style="align-self: flex-start" @click="enable">{{ busy ? t('common.loading') : t('iphone.share') }}</button>
      <p v-else class="muted" style="font-size: 13px">{{ t('setup.google.onlyLocal') }}</p>
    </template>
    <template v-else>
      <span class="status ok"><span class="dot" aria-hidden="true" /> {{ t('iphone.ready') }}</span>
      <div style="display: flex; flex-wrap: wrap; gap: 16px; align-items: center">
        <img v-if="qr" :src="qr" width="160" height="160" :alt="t('iphone.qrAlt')" style="border-radius: 12px" />
        <ol class="howto" style="flex: 1 1 180px">
          <li>{{ t('iphone.step1') }}</li>
          <li>{{ t('iphone.step2') }}</li>
          <li>{{ t('iphone.step3') }}</li>
        </ol>
      </div>
      <span class="mono muted" style="font-size: 12px; overflow-wrap: anywhere">{{ r.url }}</span>
    </template>
    <span :class="['status', aiOk ? 'ok' : 'ko']" style="margin-top: auto; font-size: 13px">
      <span class="dot" aria-hidden="true" /> {{ aiOk ? t('iphone.aiOk') : t('iphone.aiKo') }}
    </span>
  </section>
</template>
