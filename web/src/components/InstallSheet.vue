<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import Icon from './Icon.vue';

/** How to add Calm where Safari cannot install it from a button: iPhone / iPad (Share menu) and Mac (Add to Dock). */
defineProps<{ mode: 'ios' | 'mac-safari' }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const onKey = (e: KeyboardEvent) => e.key === 'Escape' && emit('close');
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div class="sheet-backdrop" @click.self="emit('close')">
      <section class="sheet rise" role="dialog" aria-modal="true" :aria-label="t('install.title')">
        <div class="sheet-grip" aria-hidden="true" />
        <header class="sheet-head">
          <span class="eyebrow" style="display: flex; align-items: center; gap: 8px"><Icon name="download" :size="14" /> {{ t('install.title') }}</span>
          <button type="button" class="btn btn-icon" :aria-label="t('common.close')" @click="emit('close')">×</button>
        </header>
        <ol v-if="mode === 'ios'" class="install-steps">
          <li><span class="install-key" aria-hidden="true"><Icon name="share" :size="18" /></span> {{ t('install.ios1') }}</li>
          <li><span class="install-key" aria-hidden="true"><Icon name="plus" :size="18" /></span> {{ t('install.ios2') }}</li>
          <li><span class="install-key" aria-hidden="true"><Icon name="check" :size="18" /></span> {{ t('install.ios3') }}</li>
        </ol>
        <ol v-else class="install-steps">
          <li><span class="install-key" aria-hidden="true"><Icon name="share" :size="18" /></span> {{ t('install.mac1') }}</li>
          <li><span class="install-key" aria-hidden="true"><Icon name="check" :size="18" /></span> {{ t('install.mac2') }}</li>
        </ol>
        <p class="muted" style="margin: 0; font-size: 13px; line-height: 1.5">{{ t(mode === 'ios' ? 'install.iosNote' : 'install.macNote') }}</p>
      </section>
    </div>
  </Teleport>
</template>
