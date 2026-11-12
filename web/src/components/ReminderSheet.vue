<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, post, type Reminder } from '../api.ts';
import { dateLocale } from '../i18n.ts';
import { dueChoices } from '../remind.ts';
import { goTo, notify, notifyError, store } from '../store.ts';
import Icon from './Icon.vue';

/**
 * Notes something to do later, or edits a reminder. From a mail, Calm suggests the task and a date (the user can
 * type over it while Calm reads); quick choices for when, a precise date, or none.
 */
const props = defineProps<{ mailId?: string; reminder?: Reminder }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

const text = ref(props.reminder?.text ?? '');
const due = ref<number | null>(props.reminder?.due ?? null);
const thinking = ref(false);
const saving = ref(false);
const typed = ref(false);
const choices = dueChoices(new Date());
const toLocal = (ms: number) => new Date(ms).toLocaleString('sv-SE').replace(' ', 'T').slice(0, 16);
const custom = ref(false);
const picked = computed(() => (custom.value ? 'pick' : due.value === null ? 'someday' : (choices.find((c) => c.at === due.value)?.key ?? 'pick')));
const choose = (at: number | null) => {
  custom.value = false;
  due.value = at;
};
const dueText = computed(() =>
  due.value === null ? '' : new Date(due.value).toLocaleString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }),
);
const pickInput = ref<HTMLInputElement | null>(null);
function pickDate() {
  custom.value = true;
  if (due.value === null) due.value = choices[0].at;
  queueMicrotask(() => pickInput.value?.showPicker?.());
}

onMounted(async () => {
  window.addEventListener('keydown', onKey);
  if (!props.mailId || props.reminder) return;
  thinking.value = true;
  try {
    const s = await post<{ text: string; due: number | null }>(`/api/mail/${encodeURIComponent(props.mailId)}/reminder`);
    if (!typed.value && s.text) text.value = s.text;
    if (s.due !== null && due.value === null) due.value = s.due;
  } catch {
    /* no suggestion: the user writes it */
  } finally {
    thinking.value = false;
  }
});
const onKey = (e: KeyboardEvent) => e.key === 'Escape' && emit('close');
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

async function save() {
  if (!text.value.trim() || saving.value) return;
  saving.value = true;
  try {
    if (props.reminder) await api(`/api/reminders/${encodeURIComponent(props.reminder.id)}`, { method: 'PATCH', body: JSON.stringify({ text: text.value, due: due.value }) });
    else await post('/api/reminders', { text: text.value, due: due.value, mailId: props.mailId });
    store.remindersVersion++;
    notify(t('remind.saved'), false, props.reminder ? undefined : { label: t('remind.see'), run: () => goTo('rappels') });
    emit('close');
  } catch (e) {
    notifyError(e);
  } finally {
    saving.value = false;
  }
}

async function remove() {
  if (!props.reminder) return;
  try {
    await api(`/api/reminders/${encodeURIComponent(props.reminder.id)}`, { method: 'DELETE' });
    store.remindersVersion++;
    notify(t('remind.deleted'));
    emit('close');
  } catch (e) {
    notifyError(e);
  }
}
</script>

<template>
  <!-- In body: opened from a mail, it must not be trapped in the reader's own layer (under the menu bar). -->
  <Teleport to="body">
  <div class="sheet-backdrop" @click.self="emit('close')">
    <form class="sheet rise remind-sheet" role="dialog" aria-modal="true" :aria-label="reminder ? t('remind.edit') : t('remind.noteTitle')" @submit.prevent="save">
      <div class="sheet-grip" aria-hidden="true" />
      <header class="sheet-head">
        <span class="eyebrow" style="display: flex; align-items: center; gap: 8px"><Icon name="clock" :size="14" /> {{ reminder ? t('remind.edit') : t('remind.noteTitle') }}</span>
        <button type="button" class="btn btn-icon" :aria-label="t('common.close')" @click="emit('close')">×</button>
      </header>

      <label class="remind-what">
        <span class="sr">{{ t('remind.what') }}</span>
        <textarea v-model="text" rows="2" maxlength="300" :placeholder="thinking ? t('remind.thinking') : t('remind.placeholder')" @input="typed = true" />
        <span v-if="thinking" class="remind-thinking"><span class="dot" aria-hidden="true" /> {{ t('remind.thinking') }}</span>
      </label>

      <fieldset class="remind-when">
        <legend class="eyebrow">{{ t('remind.when') }}</legend>
        <div class="remind-chips">
          <button v-for="c in choices" :key="c.key" type="button" class="when-chip" :aria-pressed="picked === c.key" @click="choose(c.at)">{{ t(`remind.choices.${c.key}`) }}</button>
          <button type="button" class="when-chip" :aria-pressed="picked === 'pick'" @click="pickDate">{{ t('remind.pick') }}</button>
          <button type="button" class="when-chip" :aria-pressed="picked === 'someday'" @click="choose(null)">{{ t('remind.someday') }}</button>
        </div>
        <input
          v-if="picked === 'pick'"
          ref="pickInput"
          class="field remind-date"
          type="datetime-local"
          :value="due === null ? '' : toLocal(due)"
          @change="due = ($event.target as HTMLInputElement).value ? new Date(($event.target as HTMLInputElement).value).getTime() : null"
        />
        <p v-if="dueText" class="muted remind-due">{{ dueText }}</p>
      </fieldset>

      <div class="remind-foot">
        <button v-if="reminder" type="button" class="btn btn-danger" @click="remove"><Icon name="trash" :size="16" /> {{ t('remind.delete') }}</button>
        <button class="btn btn-prim" :disabled="!text.trim() || saving">{{ t('remind.save') }}</button>
      </div>
    </form>
  </div>
  </Teleport>
</template>
