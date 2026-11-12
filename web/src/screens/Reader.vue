<script setup lang="ts">
import { computed, ref, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { actionLinks, api, CAT_COLOR, post, useMailBody, when, type MailItem, fullDate } from '../api.ts';
import Icon from '../components/Icon.vue';
import { dateLocale } from '../i18n.ts';
import { notify, notifyError, openEditor } from '../store.ts';
import MailBody from '../components/MailBody.vue';
import { richText } from '../format.ts';
import { isUnread } from '../unread.ts';
import { actionKinds, fileTarget } from '../actions.ts';
import { findPhones } from '../phones.ts';
import { useUnsubscribe } from '../unsub.ts';
import UnsubBar from './UnsubBar.vue';
import ReminderSheet from '../components/ReminderSheet.vue';

const props = defineProps<{ mail: MailItem; busy: boolean }>();
const emit = defineEmits<{ back: []; archive: []; trash: []; handled: []; label: [id: string, name: string]; toggleRead: []; file: [name: string] }>();
const { t } = useI18n();

const a = computed(() => props.mail.analysis);
const body = useMailBody(toRef(() => props.mail.id));
const labels = ref<{ id: string; name: string }[] | null>(null);
const menu = ref(false);
const remind = ref(false);
/** The suggested action as buttons that do it (unsubscribe, delete, archive, answer, remind me). */
const kinds = computed(() => (a.value?.action ? actionKinds(a.value.action) : []));
const unsub = useUnsubscribe(() => props.mail);
/** "Ranger dans Factures": a button that files the mail there (the folder is made when missing). */
/** Phone numbers in the mail, offered as call buttons (three at most, each once). */
const phones = computed(() => [...new Map(findPhones(body.value ?? '').map((p) => [p.tel, p])).values()].slice(0, 3));
const folder = computed(() => (a.value?.action ? fileTarget(a.value.action) : null));
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
    <ReminderSheet v-if="remind" :mail-id="mail.id" @close="remind = false" />
    <div class="reader-top">
      <button type="button" class="btn back" @click="emit('back')"><Icon name="back" :size="16" /> {{ t('common.back') }}</button>
      <span class="eyebrow" style="display: flex; align-items: center; gap: 8px; font-size: 12px; min-width: 0">
        <span aria-hidden="true" :style="{ flex: 'none', width: '8px', height: '8px', borderRadius: '2px', background: a ? CAT_COLOR[a.category] : 'var(--line)' }" />
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ a ? t(`cat.${a.category}`) : t('cat.untriaged') }} · {{ when(mail.date) }}</span>
      </span>
      <div class="actions">
        <button v-if="a?.category === 'reply'" type="button" class="btn handled" :aria-label="t('reader.handled')" :title="t('reader.handledHint')" :disabled="busy" @click="emit('handled')">
          <Icon name="check" :size="16" /> <span class="wide-only">{{ t('reader.handled') }}</span>
        </button>
        <button type="button" :class="['btn btn-icon', { 'is-unread': isUnread(mail) }]" :aria-label="isUnread(mail) ? t('reader.markRead') : t('reader.markUnread')" :title="isUnread(mail) ? t('reader.markRead') : t('reader.markUnread')" :aria-pressed="isUnread(mail)" @click="emit('toggleRead')"><Icon name="mail" :size="18" /></button>
        <button type="button" class="btn btn-icon" :aria-label="t('reader.remind')" :title="t('reader.remind')" @click="remind = true"><Icon name="clock" :size="18" /></button>
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
    <div style="display: flex; flex-direction: column; gap: 10px; min-width: 0">
      <h2>{{ mail.subject || t('common.noSubject') }}</h2>
      <span class="muted" style="font-size: 14px; overflow-wrap: anywhere">
        {{ mail.fromName }} <span class="mono" style="font-size: 12px">&lt;{{ mail.fromEmail }}&gt;</span>
      </span>
      <time class="mail-date" :datetime="new Date(mail.date).toISOString()">{{ fullDate(mail.date) }}</time>
    </div>

    <section v-if="a" class="claude-box" :aria-label="t('reader.calmeRead')">
      <span class="eyebrow" style="display: flex; align-items: center; gap: 8px"><span class="dot" /> {{ t('reader.calmeRead') }}</span>
      <ol>
        <li v-for="(s, i) in a.summary" :key="i"><span>0{{ i + 1 }}</span><span>{{ s }}</span></li>
      </ol>
      <a v-if="a.action && actionLinks.get(mail.id)?.via !== 'summary' && actionLinks.get(mail.id)" class="act act-link" :href="actionLinks.get(mail.id)!.url" target="_blank" rel="noopener noreferrer">→ {{ a.action }} <span class="act-host mono">{{ actionLinks.get(mail.id)!.host }} ↗</span></a>
      <span v-else-if="a.action" class="act">→ {{ a.action }}</span>
      <a v-if="actionLinks.get(mail.id)?.via === 'summary'" class="mail-link" :href="actionLinks.get(mail.id)!.url" target="_blank" rel="noopener noreferrer">
        ↗ {{ actionLinks.get(mail.id)!.label }} <span class="act-host mono">{{ actionLinks.get(mail.id)!.host }}</span>
      </a>
      <div v-if="phones.length" class="act-buttons">
        <a v-for="p in phones" :key="p.tel" class="btn" :href="p.tel"><Icon name="phone" :size="16" /> {{ p.raw }}</a>
      </div>
      <div v-if="kinds.length || folder" class="act-buttons">
        <button v-if="folder" type="button" class="btn btn-prim" :disabled="busy" @click="emit('file', folder)"><Icon name="folder" :size="16" /> {{ t('reader.fileIn', { name: folder }) }}</button>
        <button v-if="kinds.includes('unsub')" type="button" class="btn btn-prim" :disabled="unsub.status.value !== 'idle'" @click="unsub.go()">
          <Icon name="unsub" :size="16" /> {{ unsub.status.value === 'done' ? t('reader.unsubscribed') : unsub.status.value === 'busy' ? t('reader.unsubscribing') : t('reader.unsubscribe') }}
        </button>
        <button v-if="kinds.includes('trash')" type="button" class="btn btn-danger" :disabled="busy" @click="emit('trash')"><Icon name="trash" :size="16" /> {{ t('reader.trash') }}</button>
        <button v-if="kinds.includes('archive')" type="button" class="btn" :disabled="busy" @click="emit('archive')"><Icon name="archive" :size="16" /> {{ t('reader.archive') }}</button>
        <button v-if="kinds.includes('reply')" type="button" class="btn" @click="openEditor({ mailId: mail.id, text: '' })"><Icon name="pen" :size="16" /> {{ t('common.write') }}</button>
        <button v-if="kinds.includes('remind')" type="button" class="btn" @click="remind = true"><Icon name="clock" :size="16" /> {{ t('reader.remind') }}</button>
      </div>
    </section>

    <section v-if="a?.event" class="event-card" :aria-label="t('reader.eventFound')">
      <div style="flex: 1 1 220px; min-width: 0; display: flex; flex-direction: column; gap: 4px">
        <span class="eyebrow">{{ t('reader.eventFound') }}</span>
        <span class="serif" style="font-size: 19px; line-height: 1.15">{{ a.event.title }}</span>
        <span class="muted" style="font-size: 13px">{{ eventDate(a.event.start, a.event.end) }}{{ a.event.location ? ` · ${a.event.location}` : '' }}</span>
      </div>
      <a v-if="eventLink" class="btn" :href="eventLink" target="_blank" rel="noopener noreferrer">{{ t('reader.seeInCalendar') }}</a>
      <button v-else type="button" class="btn btn-prim" :disabled="busy" @click="addEvent">{{ t('reader.addToCalendar') }}</button>
    </section>

    <UnsubBar v-if="mail.unsub" :mail="mail" />

    <MailBody :mail-id="mail.id" :text="body ?? mail.snippet" />

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
          <span class="q">
            <span v-for="(para, k) in richText(r.text)" :key="k" class="q-p">
              <template v-for="(s, j) in para" :key="j"><strong v-if="s.bold">{{ s.text }}</strong><template v-else>{{ s.text }}</template></template>
            </span>
          </span>
          <span class="muted" style="margin-top: auto; font-size: 12px">{{ t('reader.reviewSend') }}</span>
        </button>
      </div>
    </section>
  </article>
</template>
