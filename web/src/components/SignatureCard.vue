<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api.ts';
import { richText } from '../format.ts';
import { notify, notifyError } from '../store.ts';

/** Email signature: written in Calm's light markup (lines, **bold**, links), imported from Gmail, added when sending. */
const props = defineProps<{ signature: string; on: boolean }>();
const emit = defineEmits<{ save: [patch: { signature?: string; signatureOn?: boolean }] }>();
const { t } = useI18n();
const text = ref(props.signature);
watch(() => props.signature, (v) => (text.value = v));
const preview = computed(() => richText(text.value));
const dirty = computed(() => text.value !== props.signature);
const importing = ref(false);

async function importGmail() {
  importing.value = true;
  try {
    const r = await api<{ text: string }>('/api/signature/gmail');
    if (!r.text) notify(t('signature.noneInGmail'));
    else text.value = r.text;
  } catch (e) {
    notifyError(e);
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <section class="card" aria-labelledby="a-sig">
    <h2 id="a-sig">{{ t('signature.title') }}</h2>
    <label class="switch">
      <input type="checkbox" :checked="on" @change="emit('save', { signatureOn: ($event.target as HTMLInputElement).checked })" />
      {{ t('signature.on') }}
    </label>
    <label class="sig-edit">
      <span class="eyebrow">{{ t('signature.text') }}</span>
      <textarea id="sig-text" v-model="text" class="plain" rows="4" :placeholder="t('signature.placeholder')" />
    </label>
    <div v-if="preview.length" class="sig-preview" :aria-label="t('signature.preview')">
      <span class="mono">--</span>
      <p v-for="(para, i) in preview" :key="i"><template v-for="(s, j) in para" :key="j"><strong v-if="s.bold">{{ s.text }}</strong><template v-else>{{ s.text }}</template></template></p>
    </div>
    <span style="display: flex; flex-wrap: wrap; gap: 8px">
      <button type="button" class="btn btn-prim" :disabled="!dirty" @click="emit('save', { signature: text })">{{ t('signature.save') }}</button>
      <button type="button" class="btn" :disabled="importing" @click="importGmail">{{ importing ? t('common.loading') : t('signature.import') }}</button>
    </span>
    <p class="muted" style="margin: 0; font-size: 12px; line-height: 1.5; margin-top: auto">{{ t('signature.note') }}</p>
  </section>
</template>
