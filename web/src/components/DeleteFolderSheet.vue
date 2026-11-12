<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api.ts';
import { notify, notifyError, store } from '../store.ts';
import Icon from './Icon.vue';

/**
 * Deleting a folder (a Gmail label) never deletes its mails. They can first go to another folder or back to the
 * inbox; otherwise they stay in Gmail's "All mail", found by the search.
 */
type Label = { id: string; name: string };
const props = defineProps<{ label: Label; count: number | null }>();
const emit = defineEmits<{ close: []; deleted: [] }>();
const { t } = useI18n();
const labels = ref<Label[]>([]);
const choice = ref<'move' | 'inbox' | 'keep'>('move');
const target = ref('');
const busy = ref(false);
const others = computed(() => labels.value.filter((l) => l.id !== props.label.id && !l.name.startsWith(`${props.label.name}/`)).sort((a, b) => a.name.localeCompare(b.name)));
const children = computed(() => labels.value.filter((l) => l.name.startsWith(`${props.label.name}/`)));

onMounted(async () => {
  window.addEventListener('keydown', onKey);
  labels.value = await api<Label[]>('/api/labels').catch(() => []);
  target.value = others.value[0]?.id ?? '';
  if (!target.value) choice.value = 'inbox';
});
const onKey = (e: KeyboardEvent) => e.key === 'Escape' && emit('close');
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

async function remove() {
  if (busy.value || (choice.value === 'move' && !target.value)) return;
  busy.value = true;
  const moveTo = choice.value === 'move' ? target.value : choice.value === 'inbox' ? 'INBOX' : '';
  try {
    const r = await api<{ moved: number }>(`/api/labels/${encodeURIComponent(props.label.id)}${moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : ''}`, { method: 'DELETE' });
    store.labelsVersion++;
    notify(t('folders.deleted', { name: props.label.name, n: r.moved }));
    emit('deleted');
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
      <section class="sheet rise" role="dialog" aria-modal="true" :aria-label="t('folders.deleteTitle', { name: label.name })">
        <div class="sheet-grip" aria-hidden="true" />
        <header class="sheet-head">
          <span class="eyebrow" style="display: flex; align-items: center; gap: 8px"><Icon name="trash" :size="14" /> {{ t('folders.deleteTitle', { name: label.name }) }}</span>
          <button type="button" class="btn btn-icon" :aria-label="t('common.close')" @click="emit('close')">×</button>
        </header>
        <p style="margin: 0; font-size: 15px; line-height: 1.5">{{ t('folders.deleteNote', { n: count ?? '…' }) }}</p>
        <p v-if="children.length" class="warn" style="margin: 0">{{ t('folders.deleteChildren', { n: children.length }) }}</p>
        <fieldset class="delete-choices">
          <legend class="eyebrow">{{ t('folders.deleteWhat') }}</legend>
          <label v-if="others.length" class="delete-choice">
            <input v-model="choice" type="radio" value="move" />
            <span>{{ t('folders.moveTo') }}</span>
            <select v-model="target" class="select" :disabled="choice !== 'move'" @focus="choice = 'move'">
              <option v-for="l in others" :key="l.id" :value="l.id">{{ l.name }}</option>
            </select>
          </label>
          <label class="delete-choice"><input v-model="choice" type="radio" value="inbox" /> <span>{{ t('folders.backToInbox') }}</span></label>
          <label class="delete-choice"><input v-model="choice" type="radio" value="keep" /> <span>{{ t('folders.leaveAll') }}</span></label>
        </fieldset>
        <div class="remind-foot">
          <button type="button" class="btn" @click="emit('close')">{{ t('common.cancel') }}</button>
          <button type="button" class="btn btn-danger" :disabled="busy" @click="remove"><Icon name="trash" :size="16" /> {{ t('folders.deleteGo') }}</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
