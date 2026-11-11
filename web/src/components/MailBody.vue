<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api.ts';
import { store } from '../store.ts';

/**
 * A mail's body: its formatted version (HTML cleaned by the server) in a sealed frame — no scripts, no forms, links
 * open outside, remote images blocked until asked for (they often report that the mail was opened). Mails without
 * HTML show their text with clickable links. Images load unless the user blocked them in Admin › App (some senders
 * use them to know a mail was opened); then a button shows them for this mail.
 */
const props = defineProps<{ mailId: string; text: string | null }>();
const { t } = useI18n();
const html = ref<string | null | undefined>(undefined);
const imagesByDefault = () => store.state?.remoteImages ?? true;
const images = ref(imagesByDefault());
const frame = ref<HTMLIFrameElement | null>(null);
const height = ref(120);

watch(
  () => props.mailId,
  async (id) => {
    html.value = undefined;
    images.value = imagesByDefault();
    try {
      html.value = (await api<{ html: string | null }>(`/api/mail/${encodeURIComponent(id)}/html`)).html;
    } catch {
      html.value = null;
    }
  },
  { immediate: true },
);

const hasRemote = computed(() => Boolean(html.value && /(?:src|background)\s*=\s*["']?\s*https?:|url\(\s*["']?\s*https?:/i.test(html.value)));

const doc = computed(() => {
  if (!html.value) return '';
  const img = images.value ? 'data: https:' : 'data:';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${img}; style-src 'unsafe-inline'; font-src data:">
<meta name="viewport" content="width=device-width, initial-scale=1"><base target="_blank">
<style>html,body{margin:0;background:#fff;color:#1b1b1f}body{padding:20px;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}a{color:#1a56c4}</style>
</head><body>${html.value}</body></html>`;
});

let resize: ResizeObserver | null = null;
function measure() {
  const d = frame.value?.contentDocument;
  if (!d?.body) return;
  const fit = () => (height.value = Math.max(80, d.documentElement.scrollHeight));
  fit();
  resize?.disconnect();
  resize = new ResizeObserver(fit);
  resize.observe(d.body);
  d.querySelectorAll('img').forEach((i) => i.addEventListener('load', fit));
}
onBeforeUnmount(() => resize?.disconnect());

// Text mails: split out the links so they can be clicked.
const parts = computed(() =>
  (props.text ?? '').split(/(https?:\/\/[^\s<>"')\]]+)/g).map((s, i) => (i % 2 ? { text: s, url: s } : { text: s, url: null })),
);
</script>

<template>
  <div v-if="html === undefined" class="mail-loading" aria-busy="true" />
  <div v-else-if="html" class="mail-html">
    <div v-if="hasRemote && !images" class="img-bar">
      <span>{{ t('reader.imagesBlocked') }}</span>
      <button type="button" class="btn" @click="images = true">{{ t('reader.showImages') }}</button>
    </div>
    <div class="mail-paper">
      <iframe
        ref="frame"
        :key="String(images)"
        :srcdoc="doc"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerpolicy="no-referrer"
        :title="t('reader.content')"
        :style="{ height: `${height}px` }"
        @load="measure"
      />
    </div>
  </div>
  <div v-else class="mail-body">
    <template v-for="(p, i) in parts" :key="i">
      <a v-if="p.url" :href="p.url" target="_blank" rel="noopener noreferrer">{{ p.text }}</a>
      <template v-else>{{ p.text }}</template>
    </template>
  </div>
</template>
