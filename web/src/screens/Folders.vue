<script setup lang="ts">
import { onMounted, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, useMailBody, when, type MailItem } from '../api.ts';
import Icon from '../components/Icon.vue';
import { notifyError } from '../store.ts';

type Label = { id: string; name: string };
const props = defineProps<{ labelId: string }>();
const { t } = useI18n();
const labels = ref<Label[] | null>(null);
const label = ref<Label | null>(null);
const mails = ref<MailItem[] | null>(null);
const open = ref<MailItem | null>(null);
const body = useMailBody(toRef(() => open.value?.id), ref('gmail'));

onMounted(() => api<Label[]>('/api/labels').then((l) => (labels.value = l)).catch(notifyError));

async function load(l: Label) {
  label.value = l;
  mails.value = null;
  open.value = null;
  try {
    mails.value = await api<MailItem[]>(`/api/labels/${encodeURIComponent(l.id)}/messages`);
  } catch (e) {
    notifyError(e);
    mails.value = [];
  }
}
watch([() => props.labelId, labels], () => {
  const l = labels.value?.find((x) => x.id === props.labelId);
  if (l && l.id !== label.value?.id) void load(l);
});
const pick = (l: Label) => (location.hash = `/dossiers/${encodeURIComponent(l.id)}`);
</script>

<template>
  <header class="topbar">
    <span class="eyebrow">{{ t('folders.eyebrow') }}{{ label ? ` · ${label.name}` : '' }}</span>
  </header>
  <h1 class="headline">{{ t('folders.headline') }} <em>{{ t('folders.headlineEm') }}</em></h1>

  <nav :aria-label="t('nav.folders')" class="folders">
    <span v-if="labels === null" class="muted">{{ t('common.loading') }}</span>
    <span v-else-if="!labels.length" class="muted">{{ t('folders.none') }}</span>
    <button v-for="l in labels ?? []" :key="l.id" type="button" class="folder" :aria-pressed="label?.id === l.id" @click="pick(l)"><Icon name="folder" :size="16" /> {{ l.name }}</button>
  </nav>

  <div v-if="label" :class="['split', { reading: open }]">
    <section class="list" :aria-label="label.name">
      <p v-if="mails === null" class="empty">{{ t('common.loading') }}</p>
      <p v-else-if="!mails.length" class="empty">{{ t('folders.empty') }}</p>
      <button v-for="m in mails ?? []" :key="m.id" type="button" class="row" :aria-current="open?.id === m.id" @click="open = m">
        <span class="mark" style="background: var(--line)" aria-hidden="true" />
        <span class="from">{{ m.fromName }}</span>
        <span class="time">{{ when(m.date) }}</span>
        <span class="subj">{{ m.subject || t('common.noSubject') }}</span>
        <span class="one">{{ m.snippet }}</span>
      </button>
    </section>
    <article v-if="open" class="reader rise" :aria-label="t('reader.label')">
      <button type="button" class="btn back" style="align-self: flex-start" @click="open = null"><Icon name="back" :size="16" /> {{ t('common.back') }}</button>
      <div style="display: flex; flex-direction: column; gap: 10px">
        <span class="eyebrow">{{ label.name }} · {{ when(open.date) }}</span>
        <h2>{{ open.subject || t('common.noSubject') }}</h2>
        <span class="muted" style="font-size: 14px; overflow-wrap: anywhere">{{ open.fromName }} <span class="mono" style="font-size: 12px">&lt;{{ open.fromEmail }}&gt;</span></span>
      </div>
      <div class="mail-body">{{ body ?? open.snippet }}</div>
    </article>
  </div>
</template>
