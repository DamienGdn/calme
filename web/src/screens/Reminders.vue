<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import RemindersPanel from '../components/RemindersPanel.vue';

/** Reminders on their own page (sidebar, notifications); the agenda shows the same list. */
const { t } = useI18n();
</script>

<template>
  <header class="topbar"><span class="eyebrow">{{ t('remind.title') }}</span></header>
  <h1 class="headline">{{ t('remind.headline') }} <em>{{ t('remind.headlineEm') }}</em></h1>
  <RemindersPanel />
</template>
