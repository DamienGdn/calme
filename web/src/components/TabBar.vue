<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import Icon from './Icon.vue';

/** Open mails as tabs, with the compare toggle (two mails side by side). */
defineProps<{
  items: { id: string; name: string; subject: string; color: string }[];
  active: string | null;
  compare: string | null;
  canCompare: boolean;
}>();
const emit = defineEmits<{ select: [id: string]; close: [id: string]; compare: [] }>();
const { t } = useI18n();
</script>

<template>
  <div class="open-tabs">
    <div class="tabs-scroll" role="tablist" :aria-label="t('tabs.bar')" :title="t('tabs.keys')">
      <div v-for="m in items" :key="m.id" :class="['tab', { on: m.id === active, cmp: m.id === compare }]">
        <button type="button" role="tab" class="tab-main" :aria-selected="m.id === active" :title="`${m.name} — ${m.subject}`" @click="emit('select', m.id)">
          <span class="mark" aria-hidden="true" :style="{ background: m.color }" />
          <span class="tab-name"><b>{{ m.name }}</b> {{ m.subject }}</span>
          <span v-if="m.id === compare" class="mono tab-n" aria-hidden="true">2</span>
        </button>
        <button type="button" class="tab-x" :aria-label="t('tabs.close', { name: m.name })" @click="emit('close', m.id)">×</button>
      </div>
    </div>
    <button v-if="canCompare" type="button" class="btn compare-btn" :aria-pressed="Boolean(compare)" :title="t('tabs.compareHint')" @click="emit('compare')">
      <Icon name="columns" :size="16" /> {{ compare ? t('tabs.stopCompare') : t('tabs.compare') }}
    </button>
  </div>
</template>
