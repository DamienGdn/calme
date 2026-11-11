<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, setToken, Unauthorized } from '../api.ts';
import { store } from '../store.ts';

/**
 * Pairs this screen. Usual way: ask for access, the user accepts on the computer running Calm, the token arrives.
 * Fallback: paste the token (`pnpm calme pair`).
 */
const { t } = useI18n();
const token = ref('');
const error = ref('');
const busy = ref(false);
const waiting = ref(false);
const showToken = ref(false);
let timer = 0;

async function finish(value: string) {
  setToken(value);
  await api('/api/state');
  store.paired = true;
}

async function ask() {
  error.value = '';
  busy.value = true;
  try {
    const res = await fetch('/pair/request', { method: 'POST' });
    if (res.status === 429) throw new Error(t('pairing.tooMany'));
    if (!res.ok) throw new Error(t('pairing.unreachable'));
    const { id } = (await res.json()) as { id: string };
    waiting.value = true;
    const check = async () => {
      try {
        const r = (await (await fetch(`/pair/request/${id}`)).json()) as { status: string; token?: string };
        if (r.status === 'pending') return;
        window.clearInterval(timer);
        waiting.value = false;
        if (r.status === 'approved' && r.token) await finish(r.token);
        else error.value = r.status === 'denied' ? t('pairing.denied') : t('pairing.expired');
      } catch {
        /* network blip: try again on the next tick */
      }
    };
    timer = window.setInterval(check, 2000);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

function cancel() {
  window.clearInterval(timer);
  waiting.value = false;
}

async function submitToken() {
  busy.value = true;
  error.value = '';
  try {
    await finish(token.value.trim());
  } catch (err) {
    setToken(null);
    error.value = err instanceof Unauthorized ? t('pairing.badToken') : t('pairing.unreachable');
  } finally {
    busy.value = false;
  }
}

onBeforeUnmount(() => window.clearInterval(timer));
</script>

<template>
  <div class="pairing">
    <div class="rise pair-box">
      <div class="logo" aria-hidden="true">c.</div>
      <h1 class="headline" style="font-size: 40px">{{ t('pairing.title') }} <em>{{ t('pairing.titleEm') }}</em></h1>
      <p class="muted" style="margin: 0; line-height: 1.6">{{ t('pairing.help') }}</p>

      <div v-if="waiting" class="pair-wait" role="status">
        <span class="dot" aria-hidden="true" />
        <span>{{ t('pairing.waiting') }}</span>
        <button type="button" class="btn" @click="cancel">{{ t('pairing.cancel') }}</button>
      </div>
      <button v-else type="button" class="btn btn-prim" :disabled="busy" @click="ask">{{ t('pairing.ask') }}</button>
      <p v-if="error" role="alert" style="margin: 0; color: var(--danger)">{{ error }}</p>

      <button v-if="!showToken" type="button" class="linkish" @click="showToken = true">{{ t('pairing.haveToken') }}</button>
      <form v-else class="pair-token" @submit.prevent="submitToken">
        <i18n-t keypath="pairing.tokenHelp" tag="p" class="muted" style="margin: 0; font-size: 13px; line-height: 1.6">
          <template #cmd><code class="mono">pnpm calme pair</code></template>
        </i18n-t>
        <label class="field">
          <span class="sr">{{ t('pairing.field') }}</span>
          <input v-model="token" :placeholder="t('pairing.field')" autocomplete="off" autocapitalize="off" spellcheck="false" class="mono" />
        </label>
        <button class="btn" :disabled="!token.trim() || busy">{{ busy ? t('pairing.checking') : t('pairing.submit') }}</button>
      </form>
    </div>
  </div>
</template>
