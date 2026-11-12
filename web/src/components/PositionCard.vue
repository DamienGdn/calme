<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dateLocale } from '../i18n.ts';
import { currentPosition, here, positionState } from '../position.ts';

/** Admin › Position: lets Calm follow where the user is, so appointments say when to leave without a tap. */
const { t } = useI18n();
const asking = ref(false);
const failed = ref(false);
async function allow() {
  asking.value = true;
  failed.value = false;
  try {
    await currentPosition();
  } catch {
    failed.value = true;
  } finally {
    asking.value = false;
  }
}
const since = computed(() => (here.value ? new Date(here.value.at).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' }) : ''));
</script>

<template>
  <section class="card" aria-labelledby="a-position">
    <h2 id="a-position">{{ t('position.title') }}</h2>
    <p class="muted" style="margin: 0; font-size: 14px; line-height: 1.5">{{ t('position.lead') }}</p>
    <p v-if="positionState === 'unsupported'" class="warn" style="margin: 0">{{ t('position.unsupported') }}</p>
    <p v-else-if="positionState === 'denied'" class="warn" style="margin: 0">{{ t('position.denied') }}</p>
    <p v-else-if="here" style="margin: 0; font-size: 14px; color: var(--accent-text)">✓ {{ t('position.on', { time: since }) }}</p>
    <button v-if="positionState !== 'unsupported' && positionState !== 'denied' && !here" type="button" class="btn btn-prim" style="align-self: flex-start" :disabled="asking" @click="allow">
      {{ asking ? t('agenda.leave.locating') : t('position.allow') }}
    </button>
    <p v-if="failed && positionState !== 'denied'" class="warn" style="margin: 0">{{ t('agenda.leave.noPos') }}</p>
    <p class="muted" style="margin: 0; font-size: 12px; line-height: 1.5">{{ t('position.note') }}</p>
  </section>
</template>
