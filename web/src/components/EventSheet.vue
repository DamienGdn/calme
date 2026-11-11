<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { dateLocale } from '../i18n.ts';
import Icon from './Icon.vue';

/** An appointment, opened from the agenda: when, which calendar, where (with a map link), notes, Google link. */
export interface OpenEvent {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string | null;
  description?: string | null;
  link?: string | null;
  calendar?: { name: string; color: string; primary: boolean };
  /** Proposed by a mail, not yet in the calendar. */
  fromMail?: string;
}
const props = defineProps<{ event: OpenEvent }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

const when = computed(() => {
  const e = props.event;
  const loc = dateLocale();
  const day = (d: Date) => d.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (e.allDay) {
    const s = new Date(e.start + 'T12:00:00');
    const last = new Date(e.end + 'T12:00:00');
    last.setDate(last.getDate() - 1);
    return last > s ? `${day(s)} → ${day(last)}` : day(s);
  }
  const s = new Date(e.start);
  const en = new Date(e.end);
  const hm = (d: Date) => d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  return s.toDateString() === en.toDateString() ? `${day(s)}, ${hm(s)} – ${hm(en)}` : `${day(s)} ${hm(s)} → ${day(en)} ${hm(en)}`;
});
const mapUrl = computed(() => (props.event.location ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(props.event.location)}` : ''));

const onKey = (e: KeyboardEvent) => e.key === 'Escape' && emit('close');
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="sheet-backdrop" @click.self="emit('close')">
    <article class="sheet rise" role="dialog" aria-modal="true" :aria-label="event.title">
      <div class="sheet-grip" aria-hidden="true" />
      <header class="sheet-head">
        <span class="eyebrow ev-cal">
          <i :style="{ background: event.fromMail ? 'var(--accent)' : (event.calendar?.color ?? 'var(--muted)') }" />
          {{ event.fromMail ? t('agenda.tagProposed') : event.calendar ? (event.calendar.primary ? t('agenda.mine') : event.calendar.name) : t('agenda.tagAgenda') }}
        </span>
        <button type="button" class="btn btn-icon" :aria-label="t('common.close')" @click="emit('close')">×</button>
      </header>
      <h2 class="ev-title-view">{{ event.title }}</h2>
      <p class="ev-when"><Icon name="calendar" :size="16" /> <span>{{ when }}</span></p>
      <p v-if="event.location" class="ev-where">
        <span>{{ event.location }}</span>
        <a :href="mapUrl" target="_blank" rel="noopener noreferrer">{{ t('agenda.form.seeMap') }} ↗</a>
      </p>
      <p v-if="event.fromMail" class="muted" style="margin: 0; font-size: 14px">{{ event.fromMail }}</p>
      <div v-if="event.description" class="ev-desc">{{ event.description }}</div>
      <a v-if="event.link" class="btn" :href="event.link" target="_blank" rel="noopener noreferrer" style="align-self: flex-start">{{ t('agenda.openInGoogle') }} ↗</a>
    </article>
  </div>
</template>
