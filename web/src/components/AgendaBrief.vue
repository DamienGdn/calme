<script setup lang="ts">
import { onActivated, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { post } from '../api.ts';
import { richText } from '../format.ts';
import { store } from '../store.ts';

/**
 * Calm's reading of the coming week (agenda and reminders): one sentence, then a few dated points. The server asks
 * Claude again only when the agenda, the reminders or the day changed, so opening the agenda is usually instant.
 */
const { t } = useI18n();
const brief = ref<{ glance: string; points: string[] } | null>(null);
const reading = ref(false);
const failed = ref(false);

async function load() {
  if (reading.value) return;
  reading.value = true;
  failed.value = false;
  try {
    brief.value = await post<{ glance: string; points: string[] }>('/api/agenda/brief');
  } catch {
    failed.value = true;
  } finally {
    reading.value = false;
  }
}
onActivated(load);
watch(() => store.remindersVersion, load, { immediate: true });

const inline = (s: string) => richText(s)[0] ?? [];
/** "Samedi 10h — dentiste" → date and fact, lined up like the search timeline. */
const point = (p: string) => {
  const m = /^(.{2,28}?)\s+[—–-]\s+(.+)$/.exec(p);
  return m ? { date: m[1], text: m[2] } : { date: '', text: p };
};
</script>

<template>
  <section v-if="brief || reading" class="claude-box agenda-brief" :aria-label="t('brief.title')" :aria-busy="reading">
    <span class="eyebrow" style="display: flex; align-items: center; gap: 8px">
      <span :class="['dot', { pulsing: reading }]" /> {{ t('brief.title') }}
    </span>
    <p v-if="!brief" class="muted" style="margin: 0">{{ t('brief.reading') }}</p>
    <template v-else>
      <p class="answer-lead">
        <template v-for="(s, i) in inline(brief.glance)" :key="i"><strong v-if="s.bold">{{ s.text }}</strong><template v-else>{{ s.text }}</template></template>
      </p>
      <ol v-if="brief.points.length" class="points">
        <li v-for="(p, i) in brief.points" :key="i">
          <span class="mono">{{ point(p).date }}</span>
          <span><template v-for="(s, k) in inline(point(p).text)" :key="k"><strong v-if="s.bold">{{ s.text }}</strong><template v-else>{{ s.text }}</template></template></span>
        </li>
      </ol>
    </template>
  </section>
</template>
