<script setup lang="ts">
import { computed, onMounted, ref, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, fullDate, post, useMailBody, when, type MailItem } from '../api.ts';
import Icon from '../components/Icon.vue';
import MailBody from '../components/MailBody.vue';
import SenderAvatar from '../components/SenderAvatar.vue';
import { pickWith, toggleKey } from '../selection.ts';
import { notify, notifyError, refresh } from '../store.ts';
import { useMedia } from '../tabs.ts';

/**
 * Gmail's trash (mails are kept there 30 days): read a deleted mail, bring one or several back. Calm never empties
 * the trash and never deletes for good.
 */
const { t } = useI18n();
const phone = useMedia('(max-width: 720px)');
const mails = ref<MailItem[] | null>(null);
const open = ref<MailItem | null>(null);
const body = useMailBody(toRef(() => open.value?.id), ref('gmail'));
const selected = ref(new Set<string>());
const selectMode = ref(false);
const selecting = computed(() => selectMode.value || selected.value.size > 0);
const busy = ref(false);
let anchor: string | null = null;

const load = () => api<MailItem[]>('/api/trash').then((l) => (mails.value = l)).catch((e) => {
  notifyError(e);
  mails.value = [];
});
onMounted(load);
const ids = () => (mails.value ?? []).map((m) => m.id);

function onRow(e: MouseEvent, m: MailItem) {
  if (e.shiftKey) selected.value = pickWith(selected.value, ids(), m.id, anchor, 'range');
  else if (toggleKey(e) || selecting.value) selected.value = pickWith(selected.value, ids(), m.id, anchor, 'toggle');
  else {
    open.value = m;
    if (phone.value) window.scrollTo({ top: 0 });
    return;
  }
  anchor = m.id;
}
function endSelection() {
  selected.value = new Set();
  selectMode.value = false;
  anchor = null;
}

async function restore(list: string[]) {
  if (!list.length || busy.value) return;
  busy.value = true;
  try {
    await post('/api/mails/untrash', { ids: list });
    const gone = new Set(list);
    mails.value = (mails.value ?? []).filter((m) => !gone.has(m.id));
    if (open.value && gone.has(open.value.id)) open.value = null;
    endSelection();
    notify(t('trash.restored', { n: list.length }, list.length));
    void refresh();
  } catch (e) {
    notifyError(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <header class="topbar"><span class="eyebrow">{{ t('trash.eyebrow') }}</span></header>

  <template v-if="!(phone && open)">
    <h1 class="headline">{{ t('trash.headline') }} <em>{{ t('trash.headlineEm') }}</em></h1>
    <p class="muted" style="margin: 0; font-size: 14px; max-width: 60ch">{{ t('trash.note') }}</p>
  </template>

  <div v-if="!(phone && open) && mails?.length" class="search-list-head">
    <span class="eyebrow">{{ t('folders.count', mails.length) }}</span>
    <button v-if="!selecting" type="button" class="linkish" @click="selectMode = true">{{ t('search.select') }}</button>
  </div>
  <div v-if="selecting" class="selbar" role="toolbar" :aria-label="t('triage.selection')">
    <button type="button" class="btn btn-icon" :aria-label="t('triage.clearSelection')" @click="endSelection">×</button>
    <span class="grow">{{ t('triage.selected', selected.size) }}</span>
    <button type="button" class="btn" @click="selected = new Set(ids())">{{ t('triage.selectAll') }}</button>
    <button type="button" class="btn btn-prim" :disabled="!selected.size || busy" @click="restore([...selected])"><Icon name="restore" :size="16" /> {{ t('trash.restore') }}</button>
  </div>

  <p v-if="mails === null" class="empty">{{ t('common.loading') }}</p>
  <p v-else-if="!mails.length" class="empty">{{ t('trash.empty') }}</p>

  <div v-if="mails?.length" :class="['split', { reading: open }]">
    <section class="list" :aria-label="t('nav.trash')">
      <button
        v-for="m in mails"
        :key="m.id"
        type="button"
        :class="['row', { picked: selected.has(m.id) }]"
        :aria-current="!selecting && open?.id === m.id"
        :aria-pressed="selecting ? selected.has(m.id) : undefined"
        @click="onRow($event, m)"
      >
        <span v-if="selecting" class="pick" aria-hidden="true"><Icon v-if="selected.has(m.id)" name="check" :size="12" /></span>
        <SenderAvatar v-else :name="m.fromName" :email="m.fromEmail" />
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
            <button type="button" class="btn back" @click="open = null"><Icon name="back" :size="16" /> {{ t('nav.trash') }}</button>
            <span class="eyebrow" style="font-size: 12px">{{ when(open.date) }}</span>
            <button type="button" class="btn btn-prim" :disabled="busy" @click="restore([open.id])"><Icon name="restore" :size="16" /> {{ t('trash.restore') }}</button>
          </div>
          <div style="display: flex; flex-direction: column; gap: 10px; min-width: 0">
            <h2>{{ open.subject || t('common.noSubject') }}</h2>
            <span class="muted" style="font-size: 14px; overflow-wrap: anywhere">{{ open.fromName }} <span class="mono" style="font-size: 12px">&lt;{{ open.fromEmail }}&gt;</span></span>
            <time class="mail-date" :datetime="new Date(open.date).toISOString()">{{ fullDate(open.date) }}</time>
          </div>
          <MailBody :mail-id="open.id" :text="body ?? open.snippet" source="gmail" />
        </article>
      </div>
    </div>
  </div>
</template>
