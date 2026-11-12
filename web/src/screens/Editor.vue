<script setup lang="ts">
import { computed, onMounted, ref, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { post, useMailBody, when } from '../api.ts';
import Icon from '../components/Icon.vue';
import RecipientField from '../components/RecipientField.vue';
import SignaturePreview from '../components/SignaturePreview.vue';
import { dateLocale } from '../i18n.ts';
import { draft, goTo, notify, notifyError, refresh, store } from '../store.ts';

type Tone = 'warm' | 'neutral' | 'short';
interface Slot {
  start: string;
  end: string;
}
const TONES: Tone[] = ['warm', 'neutral', 'short'];
const MAX_BYTES = 20 * 1024 * 1024;
const { t } = useI18n();

const d = draft.value;
const mail = computed(() => store.state?.emails.find((m) => m.id === d.mailId) ?? null);
const to = ref(mail.value?.fromEmail ?? '');
const cc = ref('');
const subject = ref(mail.value ? (/^re\s*:/i.test(mail.value.subject) ? mail.value.subject : `Re: ${mail.value.subject}`) : '');
/** With a signature on, the "[Prénom]" placeholder Calm's drafts end with is not needed. */
const unsign = (text: string) => (store.state?.signature ? text.replace(/\s*\[(?:Prénom|First name)\]\s*$/, '') : text);
const body = ref(unsign(d.text ?? ''));
const signature = computed(() => (store.state?.signature ?? '').trim());
const tone = ref<Tone | null>(null);
const ask = ref('');
const brief = ref('');
const files = ref<File[]>([]);
const over = ref(false);
const busy = ref<'' | 'rewrite' | 'send' | 'slots' | 'questions'>('');

/** Calm's questions on what the draft leaves unknown; the answers rewrite the reply. */
const questions = ref<{ question: string; suggestions: string[]; answer: string }[] | null>(null);
async function askQuestions() {
  if (!mail.value || !body.value.trim()) return;
  busy.value = 'questions';
  try {
    const r = await post<{ questions: { question: string; suggestions: string[] }[] }>('/api/reply/questions', { mailId: mail.value.id, draft: body.value });
    if (!r.questions.length) {
      questions.value = null;
      notify(t('editor.noQuestion'));
    } else questions.value = r.questions.map((q) => ({ ...q, answer: '' }));
  } catch (e) {
    notifyError(e);
  } finally {
    busy.value = '';
  }
}
async function applyAnswers() {
  const answered = (questions.value ?? []).filter((q) => q.answer.trim());
  if (!answered.length) return;
  const instruction = [
    'Intègre ces précisions de l’utilisateur dans la réponse et retire les éléments entre crochets qu’elles remplacent :',
    ...answered.map((q) => `- ${q.question} → ${q.answer.trim()}`),
  ].join('\n');
  await rewrite(null, instruction);
  questions.value = null;
}
const slots = ref<Slot[] | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const original = useMailBody(toRef(() => mail.value?.id));
const total = computed(() => files.value.reduce((n, f) => n + f.size, 0));

const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const slotLabel = (s: Slot) => {
  const loc = dateLocale();
  const hm = (x: string) => new Date(x).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  return `${new Date(s.start).toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' })}, ${hm(s.start)}–${hm(s.end)}`;
};

function addFiles(list: FileList | null | undefined) {
  if (!list) return;
  const next = [...files.value, ...Array.from(list)];
  if (next.reduce((n, f) => n + f.size, 0) > MAX_BYTES) return notify(t('editor.tooBig'), true);
  files.value = next;
}

async function rewrite(tn: Tone | null, instruction?: string) {
  if (!mail.value) return;
  busy.value = 'rewrite';
  try {
    const r = await post<{ draft: string }>('/api/redraft', { mailId: mail.value.id, draft: body.value, tone: tn ?? tone.value ?? 'neutral', instruction });
    body.value = unsign(r.draft);
    if (tn) tone.value = tn;
    ask.value = '';
  } catch (e) {
    notifyError(e);
  } finally {
    busy.value = '';
  }
}

/** Last subject Calm wrote: it may replace it again, but never one typed by hand. */
const autoSubject = ref<string | null>(null);
const suggesting = ref(false);
async function suggestSubject() {
  suggesting.value = true;
  try {
    const r = await post<{ subject: string }>('/api/subject', { body: body.value });
    if (r.subject) subject.value = autoSubject.value = r.subject;
  } catch (e) {
    notifyError(e);
  } finally {
    suggesting.value = false;
  }
}

async function compose() {
  busy.value = 'rewrite';
  try {
    const r = await post<{ subject: string; body: string }>('/api/compose', { to: to.value, brief: brief.value, tone: tone.value ?? 'neutral' });
    body.value = unsign(r.body);
    // Calm fills the subject, and keeps it up to date while it is still its own (not edited by hand).
    if (r.subject && (!subject.value.trim() || subject.value === autoSubject.value)) subject.value = autoSubject.value = r.subject;
  } catch (e) {
    notifyError(e);
  } finally {
    busy.value = '';
  }
}

async function proposeSlots() {
  if (!mail.value) return;
  busy.value = 'slots';
  try {
    const r = await post<{ slots: Slot[]; draft: string }>(`/api/mail/${encodeURIComponent(mail.value.id)}/slots`);
    slots.value = r.slots;
    if (r.draft) body.value = unsign(r.draft);
    if (!r.slots.length) notify(t('editor.noSlots'), true);
  } catch (e) {
    notifyError(e);
  } finally {
    busy.value = '';
  }
}
onMounted(() => {
  if (d.slots) void proposeSlots();
});

async function send() {
  if (!to.value.trim() || !body.value.trim()) return;
  busy.value = 'send';
  const form = new FormData();
  if (mail.value) form.set('mailId', mail.value.id);
  form.set('to', to.value);
  form.set('cc', cc.value);
  form.set('subject', subject.value);
  form.set('body', body.value);
  for (const f of files.value) form.append('files', f);
  try {
    await post('/api/reply', form);
    notify(mail.value ? t('editor.sentReply') : t('editor.sentNew'));
    goTo('tri');
    void refresh();
  } catch (e) {
    notifyError(e);
    busy.value = '';
  }
}

function onDrop(e: DragEvent) {
  over.value = false;
  addFiles(e.dataTransfer?.files);
}
</script>

<template>
  <header class="topbar">
    <a href="#/" class="btn btn-icon" :aria-label="t('common.backToTriage')"><Icon name="back" :size="18" /></a>
    <span class="eyebrow">{{ mail ? t('editor.reply') : t('editor.newMessage') }}</span>
  </header>

  <div class="editor-grid">
    <aside v-if="mail" class="context" :aria-label="t('editor.inReplyTo')">
      <div style="display: flex; flex-direction: column; gap: 8px">
        <span class="eyebrow">{{ t('editor.inReplyTo') }}</span>
        <span class="serif" style="font-size: 27px; line-height: 1.02; overflow-wrap: anywhere">{{ mail.subject || t('common.noSubject') }}</span>
        <span class="muted" style="font-size: 13px">{{ mail.fromName }} · {{ when(mail.date) }}</span>
      </div>
      <blockquote>{{ original ?? mail.snippet }}</blockquote>
      <section v-if="mail.analysis" class="claude-box">
        <span class="eyebrow" style="display: flex; align-items: center; gap: 8px"><span class="dot" /> {{ t('editor.understood') }}</span>
        <ul style="margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; font-size: 14px; line-height: 1.5">
          <li v-for="(s, i) in mail.analysis.summary" :key="i">{{ s }}</li>
        </ul>
      </section>
    </aside>

    <form class="letter rise" :aria-label="t('editor.message')" @submit.prevent="send">
      <div class="lines">
        <RecipientField v-model="to" :label="t('editor.to')" required />
        <RecipientField v-model="cc" :label="t('editor.cc')" />
        <label class="line" style="min-height: 64px">
          <span class="eyebrow">{{ t('editor.subject') }}</span>
          <input v-model="subject" class="subject-input" />
          <button v-if="!subject.trim() && body.trim().length > 20" type="button" class="linkish suggest-subject" :disabled="suggesting" @click="suggestSubject">
            {{ suggesting ? t('editor.thinking') : t('editor.suggestSubject') }}
          </button>
        </label>
      </div>

      <div v-if="!mail" class="compose-box">
        <span class="eyebrow" style="display: flex; align-items: center; gap: 8px"><span class="dot" /> {{ t('editor.composeTitle') }}</span>
        <label class="sr" for="brief">{{ t('editor.composeLabel') }}</label>
        <textarea id="brief" v-model="brief" rows="2" :placeholder="t('editor.composePlaceholder')" />
        <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">
          <div class="tones" role="radiogroup" :aria-label="t('editor.tone')">
            <button v-for="tn in TONES" :key="tn" type="button" role="radio" :aria-checked="(tone ?? 'neutral') === tn" @click="tone = tn">{{ t(`editor.tones.${tn}`) }}</button>
          </div>
          <button type="button" class="btn btn-prim" :disabled="!brief.trim() || busy !== ''" @click="compose">
            {{ busy === 'rewrite' ? t('editor.composing') : body.trim() ? t('editor.composeAgain') : t('editor.composeFirst') }}
          </button>
        </div>
      </div>

      <div class="toolbar">
        <button type="button" class="btn btn-icon" :aria-label="t('editor.attach')" :title="t('editor.attach')" @click="fileInput?.click()"><Icon name="clip" :size="18" /></button>
        <span style="flex: 1" />
        <button v-if="mail" type="button" class="btn" :disabled="busy !== ''" @click="proposeSlots">
          <Icon name="calendar" :size="16" /> {{ busy === 'slots' ? t('editor.lookingAgenda') : t('reader.suggestSlots') }}
        </button>
        <button v-if="mail" type="button" class="btn" :disabled="busy !== '' || !body.trim()" @click="askQuestions">
          <Icon name="search" :size="16" /> {{ busy === 'questions' ? t('editor.thinking') : t('editor.refine') }}
        </button>
        <div v-if="mail" class="tones" role="radiogroup" :aria-label="t('editor.tone')">
          <button v-for="tn in TONES" :key="tn" type="button" role="radio" :aria-checked="tone === tn" :disabled="busy !== ''" @click="rewrite(tn)">{{ t(`editor.tones.${tn}`) }}</button>
        </div>
      </div>

      <div style="padding: 24px 24px 12px; display: flex; flex-direction: column; gap: 14px">
        <span v-if="d.text" class="eyebrow" style="display: flex; align-items: center; gap: 8px">
          <span class="dot" /> {{ busy === 'rewrite' ? t('editor.rewriting') : t('editor.draftByCalme') }}
        </span>
        <div v-if="slots && slots.length" class="slots" :aria-label="t('editor.freeSlots')">
          <span class="eyebrow">{{ t('editor.freeSlots') }}</span>
          <div style="display: flex; flex-wrap: wrap; gap: 8px">
            <span v-for="s in slots" :key="s.start" class="slot">{{ slotLabel(s) }}</span>
          </div>
        </div>
        <form v-if="questions" class="qa-panel" @submit.prevent="applyAnswers">
          <span class="eyebrow" style="display: flex; align-items: center; gap: 8px"><span class="dot" /> {{ t('editor.questionsTitle') }}</span>
          <div v-for="(q, i) in questions" :key="i" class="qa">
            <label :for="`qa-${i}`">{{ q.question }}</label>
            <div v-if="q.suggestions.length" class="qa-sugg">
              <button v-for="s in q.suggestions" :key="s" type="button" :aria-pressed="q.answer === s" @click="q.answer = s">{{ s }}</button>
            </div>
            <input :id="`qa-${i}`" v-model="q.answer" class="field-input" autocomplete="off" :placeholder="t('editor.yourAnswer')" />
          </div>
          <span style="display: flex; gap: 8px; flex-wrap: wrap">
            <button class="btn btn-prim" :disabled="busy !== '' || !questions.some((q) => q.answer.trim())">{{ busy === 'rewrite' ? t('editor.rewriting') : t('editor.applyAnswers') }}</button>
            <button type="button" class="btn" @click="questions = null">{{ t('common.close') }}</button>
          </span>
        </form>
        <label class="sr" for="body">{{ t('editor.message') }}</label>
        <textarea id="body" v-model="body" :placeholder="t('editor.bodyPlaceholder')" :aria-busy="busy === 'rewrite'" />
        <p class="format-hint muted">{{ t('editor.formatHint') }}</p>
        <SignaturePreview v-if="signature" :signature="signature"><a href="#/admin" class="muted">{{ t('signature.edit') }}</a></SignaturePreview>
      </div>

      <div style="padding: 8px 24px 20px; display: flex; flex-wrap: wrap; gap: 10px">
        <span v-for="(f, i) in files" :key="i" class="file">
          <span style="display: flex; flex-direction: column; gap: 2px">
            <span style="font-weight: 500">{{ f.name }}</span>
            <span class="mono muted" style="font-size: 11px">{{ size(f.size) }}</span>
          </span>
          <button type="button" class="btn btn-icon" style="border: 0; min-height: 32px; width: 32px" :aria-label="t('common.remove', { name: f.name })" @click="files.splice(i, 1)">×</button>
        </span>
        <label :class="['dropzone', { over }]" style="flex: 1 1 200px" @dragover.prevent="over = true" @dragleave="over = false" @drop.prevent="onDrop">
          <input ref="fileInput" type="file" multiple class="sr" @change="addFiles(($event.target as HTMLInputElement).files)" />
          <i18n-t keypath="editor.drop" tag="span">
            <template #browse><span style="color: var(--ink); font-weight: 600; text-decoration: underline; text-underline-offset: 3px">{{ t('editor.browse') }}</span></template>
          </i18n-t>
          <span v-if="files.length" class="mono">· {{ size(total) }} / 20 MB</span>
        </label>
      </div>

      <div v-if="mail" class="ask">
        <span aria-hidden="true" class="mono" style="color: var(--accent-text)">›</span>
        <label class="sr" for="ask">{{ t('editor.askLabel') }}</label>
        <input id="ask" v-model="ask" :placeholder="t('editor.askPlaceholder')" @keydown.enter.prevent="ask.trim() && rewrite(null, ask)" />
        <button type="button" class="btn" :disabled="!ask.trim() || busy !== ''" @click="rewrite(null, ask)">{{ busy === 'rewrite' ? t('editor.rewriting') : t('editor.rewrite') }}</button>
      </div>

      <footer>
        <button type="submit" class="btn btn-prim" style="min-height: 48px; padding: 0 24px; font-size: 15px" :disabled="busy !== '' || !to.trim() || !body.trim()">
          {{ busy === 'send' ? t('common.sending') : t('common.send') }} <Icon name="arrow" :size="16" />
        </button>
        <span style="flex: 1" />
        <span class="serif muted" style="font-style: italic; font-size: 15px">{{ t('editor.nothingLeaves') }}</span>
      </footer>
    </form>
  </div>
</template>
