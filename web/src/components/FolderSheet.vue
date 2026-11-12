<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, post } from '../api.ts';
import { notifyError, store } from '../store.ts';
import Icon from './Icon.vue';

/**
 * Folders sheet: pick a folder to move mails into (a new one can be made on the spot), or just create one.
 * Gmail nests folders with "/": "Maison/Travaux" is "Travaux" inside "Maison".
 */
type Label = { id: string; name: string };
const props = defineProps<{ mode: 'pick' | 'create'; title: string; parent?: string }>();
const emit = defineEmits<{ close: []; pick: [label: Label]; created: [label: Label] }>();
const { t } = useI18n();
const labels = ref<Label[] | null>(null);
const name = ref('');
const parent = ref(props.parent ?? '');
const busy = ref(false);
const sorted = computed(() =>
  [...(labels.value ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })).map((l) => ({ ...l, depth: l.name.split('/').length - 1, leaf: l.name.split('/').pop() })),
);

onMounted(async () => {
  window.addEventListener('keydown', onKey);
  labels.value = await api<Label[]>('/api/labels').catch(() => []);
});
const onKey = (e: KeyboardEvent) => e.key === 'Escape' && emit('close');
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

async function create() {
  const leaf = name.value.trim();
  if (!leaf || busy.value) return;
  busy.value = true;
  try {
    const l = await post<Label>('/api/labels', { name: parent.value ? `${parent.value}/${leaf}` : leaf });
    store.labelsVersion++;
    if (props.mode === 'pick') emit('pick', l);
    else emit('created', l);
  } catch (e) {
    notifyError(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="sheet-backdrop" @click.self="emit('close')">
      <section class="sheet rise folder-sheet" role="dialog" aria-modal="true" :aria-label="title">
        <div class="sheet-grip" aria-hidden="true" />
        <header class="sheet-head">
          <span class="eyebrow" style="display: flex; align-items: center; gap: 8px"><Icon name="folder" :size="14" /> {{ title }}</span>
          <button type="button" class="btn btn-icon" :aria-label="t('common.close')" @click="emit('close')">×</button>
        </header>

        <div v-if="mode === 'pick'" class="folder-pick">
          <p v-if="labels === null" class="muted" style="margin: 0">{{ t('common.loading') }}</p>
          <button v-for="l in sorted" :key="l.id" type="button" class="folder-pick-row" :style="{ paddingLeft: `${12 + l.depth * 18}px` }" @click="emit('pick', l)">
            <Icon name="folder" :size="16" /> <span>{{ l.leaf }}</span>
          </button>
        </div>

        <form class="folder-new" @submit.prevent="create">
          <span class="eyebrow">{{ t('folders.newTitle') }}</span>
          <input v-model="name" class="field" maxlength="120" :placeholder="t('folders.namePlaceholder')" :aria-label="t('folders.name')" />
          <label class="folder-parent">
            <span class="muted">{{ t('folders.inside') }}</span>
            <select v-model="parent" class="select">
              <option value="">{{ t('folders.topLevel') }}</option>
              <option v-for="l in sorted" :key="l.id" :value="l.name">{{ '  '.repeat(l.depth) }}{{ l.name }}</option>
            </select>
          </label>
          <button class="btn btn-prim" :disabled="!name.trim() || busy" style="align-self: flex-end">
            <Icon name="plus" :size="16" /> {{ mode === 'pick' ? t('folders.createMove') : t('folders.create') }}
          </button>
        </form>
      </section>
    </div>
  </Teleport>
</template>
