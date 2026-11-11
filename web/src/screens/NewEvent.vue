<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { post } from '../api.ts';
import { notify, notifyError } from '../store.ts';

const emit = defineEmits<{ done: [] }>();
const { t } = useI18n();
const localDay = (d: Date) => d.toLocaleDateString('sv-SE');
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);

const title = ref('');
const date = ref(localDay(tomorrow));
const from = ref('10:00');
const to = ref('11:00');
const place = ref('');
const busy = ref(false);

/** Local date + time → RFC 3339 with the browser's UTC offset. */
function toIso(day: string, hm: string): string {
  const off = -new Date(`${day}T${hm}:00`).getTimezoneOffset();
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${day}T${hm}:00${off >= 0 ? '+' : '-'}${pad(off / 60)}:${pad(off % 60)}`;
}

async function submit() {
  busy.value = true;
  try {
    await post('/api/agenda/events', { title: title.value, start: toIso(date.value, from.value), end: toIso(date.value, to.value), location: place.value || null });
    notify(t('agenda.addedToast', { title: title.value }));
    emit('done');
  } catch (e) {
    notifyError(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="card rise" :aria-label="t('agenda.newEvent')" @submit.prevent="submit">
    <h2>{{ t('agenda.newEvent') }}</h2>
    <div class="form-grid">
      <label><span class="eyebrow">{{ t('agenda.form.title') }}</span><input v-model="title" class="field-input" required :placeholder="t('agenda.form.titlePh')" /></label>
      <label><span class="eyebrow">{{ t('agenda.form.date') }}</span><input v-model="date" class="field-input" type="date" required /></label>
      <label><span class="eyebrow">{{ t('agenda.form.start') }}</span><input v-model="from" class="field-input" type="time" required /></label>
      <label><span class="eyebrow">{{ t('agenda.form.end') }}</span><input v-model="to" class="field-input" type="time" required /></label>
      <label style="grid-column: 1 / -1"><span class="eyebrow">{{ t('agenda.form.place') }}</span><input v-model="place" class="field-input" /></label>
    </div>
    <button class="btn btn-prim" style="align-self: flex-start" :disabled="busy || !title.trim()">{{ busy ? t('agenda.form.adding') : t('agenda.form.submit') }}</button>
  </form>
</template>
