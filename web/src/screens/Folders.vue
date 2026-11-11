<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, useMailBody, when, type MailItem } from '../api.ts';
import Icon from '../components/Icon.vue';
import MailBody from '../components/MailBody.vue';
import { notifyError } from '../store.ts';
import { useMedia } from '../tabs.ts';

type Label = { id: string; name: string };
const props = defineProps<{ labelId: string }>();
const { t } = useI18n();
const phone = useMedia('(max-width: 720px)');
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
watch(
  [() => props.labelId, labels],
  () => {
    if (!props.labelId) {
      label.value = null;
      mails.value = null;
      open.value = null;
      return;
    }
    const l = labels.value?.find((x) => x.id === props.labelId);
    if (l && l.id !== label.value?.id) void load(l);
  },
  { immediate: true },
);
const pick = (l: Label) => (location.hash = `/dossiers/${encodeURIComponent(l.id)}`);
const backToIndex = () => (location.hash = '/dossiers');
function read(m: MailItem) {
  open.value = m;
  if (phone.value) window.scrollTo({ top: 0 });
}

/** Gmail nests labels with "/": the table of contents shows each one under its parent. */
const toc = computed(() =>
  [...(labels.value ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .map((l) => {
      const parts = l.name.split('/');
      return { ...l, leaf: parts[parts.length - 1], depth: parts.length - 1 };
    }),
);
const leaf = (l: Label) => l.name.split('/').pop() ?? l.name;
const parentPath = (l: Label) => l.name.split('/').slice(0, -1).join(' / ');
</script>

<template>
  <header class="topbar">
    <span class="eyebrow">{{ t('folders.eyebrow') }}{{ label ? ` · ${label.name}` : '' }}</span>
  </header>

  <template v-if="!(phone && label)">
    <h1 class="headline">{{ t('folders.headline') }} <em>{{ t('folders.headlineEm') }}</em></h1>

    <!-- Desktop: folders as chips above the list. -->
    <nav :aria-label="t('nav.folders')" class="folders">
      <span v-if="labels === null" class="muted">{{ t('common.loading') }}</span>
      <span v-else-if="!labels.length" class="muted">{{ t('folders.none') }}</span>
      <button v-for="l in labels ?? []" :key="l.id" type="button" class="folder" :aria-pressed="label?.id === l.id" @click="pick(l)"><Icon name="folder" :size="16" /> {{ l.name }}</button>
    </nav>

    <!-- Phone: a table of contents, sub-folders under their parent. -->
    <nav :aria-label="t('nav.folders')" class="toc">
      <p v-if="labels === null" class="muted">{{ t('common.loading') }}</p>
      <p v-else-if="!labels.length" class="empty">{{ t('folders.none') }}</p>
      <button v-for="(l, i) in toc" :key="l.id" type="button" :class="['toc-row rise', `d${Math.min(l.depth, 2)}`]" :style="{ animationDelay: `${Math.min(i, 12) * 35}ms` }" @click="pick(l)">
        <span class="toc-name">{{ l.leaf }}</span>
        <span class="toc-lead" aria-hidden="true" />
        <span class="toc-go" aria-hidden="true"><Icon name="arrow" :size="16" /></span>
      </button>
    </nav>
  </template>

  <!-- Phone: the open folder's own header. -->
  <div v-if="phone && label && !open" class="folder-head rise">
    <button type="button" class="back-link" @click="backToIndex"><Icon name="back" :size="16" /> {{ t('folders.all') }}</button>
    <span v-if="parentPath(label)" class="eyebrow">{{ parentPath(label) }}</span>
    <h1 class="folder-title">{{ leaf(label) }}</h1>
    <span class="muted mono" style="font-size: 12px">{{ mails ? t('folders.count', mails.length) : t('common.loading') }}</span>
  </div>

  <div v-if="label" :class="['split', { reading: open }]">
    <section class="list" :aria-label="label.name">
      <p v-if="mails === null" class="empty">{{ t('common.loading') }}</p>
      <p v-else-if="!mails.length" class="empty">{{ t('folders.empty') }}</p>
      <button v-for="m in mails ?? []" :key="m.id" type="button" class="row" :aria-current="open?.id === m.id" @click="read(m)">
        <span class="mark" style="background: var(--line)" aria-hidden="true" />
        <span class="from">{{ m.fromName }}</span>
        <span class="time">{{ when(m.date) }}</span>
        <span class="subj">{{ m.subject || t('common.noSubject') }}</span>
        <span class="one">{{ m.snippet }}</span>
      </button>
    </section>
    <div v-if="open" class="reading-pane">
      <div class="readers">
        <article class="reader rise" :aria-label="t('reader.label')">
          <div class="reader-top">
            <button type="button" class="btn back" @click="open = null"><Icon name="back" :size="16" /> {{ leaf(label) }}</button>
            <span class="eyebrow" style="font-size: 12px">{{ when(open.date) }}</span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 10px; min-width: 0">
            <h2>{{ open.subject || t('common.noSubject') }}</h2>
            <span class="muted" style="font-size: 14px; overflow-wrap: anywhere">{{ open.fromName }} <span class="mono" style="font-size: 12px">&lt;{{ open.fromEmail }}&gt;</span></span>
          </div>
          <MailBody :mail-id="open.id" :text="body ?? open.snippet" source="gmail" />
        </article>
      </div>
    </div>
  </div>
</template>
