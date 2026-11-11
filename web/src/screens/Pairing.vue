<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, setToken, Unauthorized } from '../api.ts';
import { store } from '../store.ts';

const { t } = useI18n();
const code = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  busy.value = true;
  error.value = '';
  setToken(code.value.trim());
  try {
    await api('/api/state');
    store.paired = true;
  } catch (err) {
    setToken(null);
    error.value = err instanceof Unauthorized ? t('pairing.badToken') : t('pairing.unreachable');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="pairing">
    <form class="rise" @submit.prevent="submit">
      <div class="logo" aria-hidden="true">c.</div>
      <h1 class="headline" style="font-size: 52px">{{ t('pairing.title') }} <em>{{ t('pairing.titleEm') }}</em></h1>
      <i18n-t keypath="pairing.help" tag="p" class="muted" style="margin: 0; line-height: 1.6">
        <template #cmd><code class="mono">pnpm calme pair</code></template>
      </i18n-t>
      <label class="field">
        <span class="sr">{{ t('pairing.field') }}</span>
        <input v-model="code" :placeholder="t('pairing.field')" autocomplete="off" autocapitalize="off" spellcheck="false" class="mono" />
      </label>
      <p v-if="error" role="alert" style="margin: 0; color: var(--danger)">{{ error }}</p>
      <button class="btn btn-prim" :disabled="!code.trim() || busy">{{ busy ? t('pairing.checking') : t('pairing.submit') }}</button>
    </form>
  </div>
</template>
