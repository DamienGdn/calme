<script setup lang="ts">
import { computed, ref, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, CAT_COLOR, post, useMailBody, when, type MailItem } from '../api.ts';
import Icon from '../components/Icon.vue';
import { dateLocale } from '../i18n.ts';
import { notify, notifyError, openEditor } from '../store.ts';
import UnsubBar from './UnsubBar.vue';

const props = defineProps<{ mail: MailItem; busy: boolean }>();
const emit = defineEmits<{ back: []; archive: []; trash: []; label: [id: string, name: string] }>();
const { t } = useI18n();

const a = computed(() => props.mail.analysis);
const body = useMailBody(toRef(() => props.mail.id));
const labels = ref<{ id: string; name: string }[] | null>(null);
const menu = ref(false);
const eventLink = ref<string | null>(null);

async function openMenu() {
  menu.value = !menu.value;
  if (!labels.value) labels.value = await api<{ id: string; name: string }[]>('/api/labels').catch(() => []);
}

async function addEvent() {
  try {
    const r = await post<{ link: string }>(`/api/mail/${encodeURIComponent(props.mail.id)}/event`);
    eventLink.value = r.link || null;
    notify(t('reader.addedToCalendar'));
  } catch (e) {
    notifyError(e);
  }
}

function eventDate(start: string, end: string) {
  const loc = dateLocale();
  const s = new Date(start);
  const tm = (d: Date) => d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  return `${s.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' })}, ${tm(s)}–${tm(new Date(end))}`;
}
</script>

<template>
  <article class="reader rise" :aria-label="t('reader.label')">
    <button type="button" class="btn back" style="align-self: flex-start" @click="emit('back')"><Icon name="back" :size="16" /> {{ t('common.back') }}</button>
    <div style="display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start">
      <div style="flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; gap: 10px">
        <span class="eyebrow" style="display: flex; align-items: center; gap: 8px; font-size: 12px">
          <span aria-hidden="true" :style="{ width: '8px', height: '8px', borderRadius: '2px', background: a ? CAT_COLOR[a.category] : 'var(--line)' }" />
          {{ a ? t(`cat.${a.category}`) : t('cat.untriaged') }} · {{ when(mail.date) }}
        </span>
        <h2>{{ mail.subject || t('common.noSubject') }}</h2>
        <span class="muted" style="font-size: 14px; overflow-wrap: anywhere">
          {{ mail.fromName }} <span class="mono" style="font-size: 12px">&lt;{{ mail.fromEmail }}&gt;</span>
        </span>
      </div>
      <div class="actions" style="position: relative">
        <button type="button" class="btn btn-icon" :aria-label="t('reader.archive')" :title="t('reader.archive')" :disabled="busy" @click="emit('archive')"><Icon name="archive" :size="18" /></button>
        <button type="button" class="btn btn-icon" :aria-label="t('reader.file')" :title="t('reader.file')" :aria-expanded="menu" :disabled="busy" @click="openMenu"><Icon name="folder" :size="18" /></button>
        <button type="button" class="btn btn-icon btn-danger" :aria-label="t('reader.trash')" aria-keyshortcuts="Enter" :title="t('reader.trashHint')" :disabled="busy" @click="emit('trash')"><Icon name="trash" :size="18" /></button>
        <div v-if="menu" class="menu" role="menu">
          <p v-if="labels === null" class="muted" style="margin: 10px">{{ t('common.loading') }}</p>
          <p v-else-if="!labels.length" class="muted" style="margin: 10px">{{ t('reader.noLabels') }}</p>
          <button v-for="l in labels ?? []" :key="l.id" type="button" role="menuitem" @click="menu = false; emit('label', l.id, l.name)">{{ l.name }}</button>
        </div>
      </div>
    </div>

    <section v-if="a" class="claude-box" :aria-label="t('reader.calmeRead')">
      <span class="eyebrow" style="display: flex; align-items: center; gap: 8px"><span class="dot" /> {{ t('reader.calmeRead') }}</span>
      <ol>
        <li v-for="(s, i) in a.summary" :key="i"><span>0{{ i + 1 }}</span><span>{{ s }}</span></li>
      </ol>
      <span v-if="a.action" class="act">→ {{ a.action }}</span>
    </section>

    <section v-if="a?.event" class="event-card" :aria-label="t('reader.eventFound')">
      <div style="flex: 1 1 220px; min-width: 0; display: flex; flex-direction: column; gap: 4px">
        <span class="eyebrow">{{ t('reader.eventFound') }}</span>
        <span class="serif" style="font-size: 22px; line-height: 1.15">{{ a.event.title }}</span>
        <span class="muted" style="font-size: 13px">{{ eventDate(a.event.start, a.event.end) }}{{ a.event.location ? ` · ${a.event.location}` : '' }}</span>
      </div>
      <a v-if="eventLink" class="btn" :href="eventLink" target="_blank" rel="noopener noreferrer">{{ t('reader.seeInCalendar') }}</a>
      <button v-else type="button" class="btn btn-prim" :disabled="busy" @click="addEvent">{{ t('reader.addToCalendar') }}</button>
    </section>

    <UnsubBar v-if="mail.unsub" :mail="mail" />

    <div class="mail-body">{{ body ?? mail.snippet }}</div>

    <div v-if="mail.attachmentNames.length" class="pj">
      <span v-for="n in mail.attachmentNames" :key="n"><Icon name="clip" :size="14" /> {{ n }}</span>
    </div>

    <section style="display: flex; flex-direction: column; gap: 14px; padding-top: 20px; border-top: 1px dashed var(--line)">
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px">
        <h3 class="eyebrow" style="margin: 0; flex: 1; font-weight: 500">{{ a?.replies.length ? t('reader.readyReplies') : t('reader.reply') }}</h3>
        <button type="button" class="btn" @click="openEditor({ mailId: mail.id, slots: true })"><Icon name="calendar" :size="16" /> {{ t('reader.suggestSlots') }}</button>
        <button type="button" class="btn" @click="openEditor({ mailId: mail.id, text: '' })"><Icon name="pen" :size="16" /> {{ t('common.write') }}</button>
      </div>
      <div v-if="a && a.replies.length" class="replies">
        <button v-for="(r, i) in a.replies" :key="i" type="button" :class="['reply-card', { best: i === 0 }]" @click="openEditor({ mailId: mail.id, text: r.text })">
          <span style="display: flex; align-items: center; gap: 8px">
            <span style="flex: 1; font-size: 13px; font-weight: 600">{{ r.label }}</span>
            <span v-if="i === 0" class="chip">{{ t('reader.advised') }}</span>
          </span>
          <span class="q">« {{ r.text }} »</span>
          <span class="muted" style="margin-top: auto; font-size: 12px">{{ t('reader.reviewSend') }}</span>
        </button>
      </div>
    </section>
  </article>
</template>
