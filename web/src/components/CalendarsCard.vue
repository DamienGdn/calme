<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api.ts';

/** Which calendars the agenda shows, for every device. */
const props = defineProps<{ hidden: string[] }>();
const emit = defineEmits<{ save: [patch: { hiddenCalendars: string[] }] }>();
const { t } = useI18n();
const cals = ref<{ id: string; name: string; color: string; primary: boolean; writable: boolean }[] | null>(null);
const limited = ref(false);
onMounted(async () => {
  try {
    const r = await api<{ calendars: NonNullable<typeof cals.value>; limitedCalendars: boolean }>('/api/agenda');
    cals.value = r.calendars;
    limited.value = r.limitedCalendars;
  } catch {
    cals.value = [];
  }
});
function toggle(id: string, shown: boolean) {
  const next = new Set(props.hidden);
  if (shown) next.delete(id);
  else next.add(id);
  emit('save', { hiddenCalendars: [...next] });
}
</script>

<template>
  <section class="card" aria-labelledby="a-cals">
    <h2 id="a-cals">{{ t('agenda.calendarsTitle') }}</h2>
    <p v-if="cals === null" class="muted">{{ t('common.loading') }}</p>
    <p v-else-if="!cals.length" class="muted" style="margin: 0; font-size: 13px">{{ t('agenda.notConnected') }}</p>
    <div v-else class="cal-list">
      <label v-for="c in cals" :key="c.id" class="cal-row">
        <input type="checkbox" :checked="!hidden.includes(c.id)" @change="toggle(c.id, ($event.target as HTMLInputElement).checked)" />
        <i :style="{ background: c.color }" aria-hidden="true" />
        <span class="grow">{{ c.primary ? t('agenda.mine') : c.name }}</span>
        <span v-if="!c.writable" class="mono muted" style="font-size: 11px">{{ t('agenda.readOnly') }}</span>
      </label>
    </div>
    <p v-if="limited" class="muted" style="margin: 0; font-size: 12px; line-height: 1.5">{{ t('agenda.limited') }}</p>
    <p class="muted" style="margin: 0; font-size: 12px; line-height: 1.5; margin-top: auto">{{ t('agenda.calendarsNote') }}</p>
  </section>
</template>
