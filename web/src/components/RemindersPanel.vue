<script setup lang="ts">
import { computed, onActivated, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, type Reminder } from '../api.ts';
import { dateLocale } from '../i18n.ts';
import { dueGroup, type DueGroup } from '../remind.ts';
import { goTo, notifyError, store } from '../store.ts';
import { openTab } from '../tabLogic.ts';
import { updateTabs } from '../tabs.ts';
import Icon from './Icon.vue';
import ReminderSheet from './ReminderSheet.vue';

/** Reminders, grouped by when (overdue first), each ticked off in one tap; the done ones folded at the end. */
const props = defineProps<{ compact?: boolean }>();
const { t } = useI18n();
const list = ref<Reminder[] | null>(null);
const editing = ref<Reminder | null>(null);
const adding = ref(false);

const load = () => api<Reminder[]>('/api/reminders').then((l) => (list.value = l)).catch(notifyError);
onActivated(load);
watch(() => store.remindersVersion, load, { immediate: true });

const GROUPS: DueGroup[] = ['late', 'today', 'soon', 'later', 'someday'];
const groups = computed(() => {
  const now = new Date();
  const open = (list.value ?? []).filter((r) => !r.done);
  return GROUPS.map((g) => ({ g, items: open.filter((r) => dueGroup(r.due, now) === g) })).filter((x) => x.items.length);
});
const done = computed(() => (list.value ?? []).filter((r) => r.done));

const dueText = (r: Reminder) => {
  if (r.due === null) return '';
  const d = new Date(r.due);
  const loc = dateLocale();
  const hm = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  return dueGroup(r.due, new Date()) === 'today' ? hm : `${d.toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short' })}, ${hm}`;
};
const inInbox = (id: string | null) => Boolean(id && store.state?.emails.some((m) => m.id === id));

async function toggle(r: Reminder) {
  const before = r.done;
  r.done = !before;
  try {
    await api(`/api/reminders/${encodeURIComponent(r.id)}`, { method: 'PATCH', body: JSON.stringify({ done: !before }) });
    store.remindersVersion++;
  } catch (e) {
    r.done = before;
    notifyError(e);
  }
}

function openMail(id: string) {
  updateTabs((st) => openTab(st, id));
  goTo('tri');
}
</script>

<template>
  <section class="reminders" :aria-label="t('remind.title')">
    <div class="reminders-head">
      <h2 class="eyebrow" style="margin: 0; font-weight: 500; display: flex; align-items: center; gap: 8px"><Icon name="clock" :size="14" /> {{ t('remind.title') }}</h2>
      <button type="button" class="btn" style="min-height: 36px" @click="adding = true">+ {{ t('remind.new') }}</button>
    </div>

    <p v-if="list && !groups.length && !(props.compact && done.length)" class="empty" style="margin: 0">{{ t('remind.empty') }}</p>

    <div v-for="x in groups" :key="x.g" class="rem-group">
      <span :class="['rem-group-title', { late: x.g === 'late' }]">{{ t(`remind.groups.${x.g}`) }}</span>
      <div v-for="r in x.items" :key="r.id" class="rem">
        <button type="button" class="rem-check" :aria-label="t('remind.markDone', { text: r.text })" @click="toggle(r)" />
        <button type="button" class="rem-body" :aria-label="t('remind.edit')" @click="editing = r">
          <span class="rem-text">{{ r.text }}</span>
          <span class="rem-meta">
            <span v-if="r.due !== null" :class="['mono', { late: x.g === 'late' }]">{{ dueText(r) }}</span>
            <span v-if="r.mailSubject" class="ellipsis">{{ t('remind.fromLine', { from: r.mailFrom, subject: r.mailSubject }) }}</span>
          </span>
        </button>
        <button v-if="inInbox(r.mailId)" type="button" class="btn btn-icon" :aria-label="t('remind.openMail')" :title="t('remind.openMail')" @click="openMail(r.mailId!)"><Icon name="mail" :size="16" /></button>
      </div>
    </div>

    <details v-if="done.length" class="rem-done">
      <summary>{{ t('remind.done', { n: done.length }) }}</summary>
      <div v-for="r in done" :key="r.id" class="rem is-done">
        <button type="button" class="rem-check on" :aria-label="t('remind.markOpen', { text: r.text })" @click="toggle(r)"><Icon name="check" :size="12" /></button>
        <button type="button" class="rem-body" @click="editing = r"><span class="rem-text">{{ r.text }}</span></button>
      </div>
    </details>

    <ReminderSheet v-if="adding" @close="adding = false" />
    <ReminderSheet v-if="editing" :reminder="editing" @close="editing = null" />
  </section>
</template>
