<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { richText } from '../format.ts';

/**
 * A signature as the mails will show it. An HTML signature (Gmail's, or pasted) renders in a sealed frame, like a
 * mail: no scripts, links open outside. Calm's light markup renders as text with bold.
 */
const props = defineProps<{ signature: string }>();
const { t } = useI18n();
const isHtml = computed(() => /<[a-z][^>]*>/i.test(props.signature));
const paras = computed(() => (isHtml.value ? [] : richText(props.signature)));
const doc = computed(
  () => `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data:">
<base target="_blank"><style>html,body{margin:0;background:#fff;color:#1b1b1f}body{padding:12px 14px;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}a{color:#1a56c4}</style>
</head><body>${props.signature}</body></html>`,
);
const frame = ref<HTMLIFrameElement | null>(null);
const height = ref(60);
let resize: ResizeObserver | null = null;
function measure() {
  const d = frame.value?.contentDocument;
  if (!d?.body) return;
  const fit = () => (height.value = Math.max(40, d.documentElement.scrollHeight));
  fit();
  resize?.disconnect();
  resize = new ResizeObserver(fit);
  resize.observe(d.body);
  d.querySelectorAll('img').forEach((i) => i.addEventListener('load', fit));
}
onBeforeUnmount(() => resize?.disconnect());
</script>

<template>
  <div class="sig-preview" :aria-label="t('signature.preview')">
    <span class="mono">--</span>
    <iframe
      v-if="isHtml"
      ref="frame"
      class="sig-frame"
      :srcdoc="doc"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerpolicy="no-referrer"
      :title="t('signature.preview')"
      :style="{ height: `${height}px` }"
      @load="measure"
    />
    <p v-for="(para, i) in paras" v-else :key="i"><template v-for="(s, j) in para" :key="j"><strong v-if="s.bold">{{ s.text }}</strong><template v-else>{{ s.text }}</template></template></p>
    <slot />
  </div>
</template>
