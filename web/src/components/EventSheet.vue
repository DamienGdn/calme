<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dateLocale } from '../i18n.ts';
import { post } from '../api.ts';
import { departure } from '../../../server/src/travel.ts';
import { directionsUrl, mapsUrl } from '../maps.ts';
import { PARKING_CHOICES, parkingFor, setParking } from '../parking.ts';
import { currentPosition, here, positionState } from '../position.ts';
import { useSheetDrag } from '../sheetDrag.ts';
import Icon from './Icon.vue';

/** An appointment, opened from the agenda: when, which calendar, where (with a map link), notes, Google link. */
export interface OpenEvent {
  id?: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string | null;
  description?: string | null;
  link?: string | null;
  calendar?: { id?: string; name: string; color: string; primary: boolean };
  /** Proposed by a mail, not yet in the calendar. */
  fromMail?: string;
}
const props = defineProps<{ event: OpenEvent; canDelete?: boolean; busy?: boolean }>();
const emit = defineEmits<{ close: []; delete: []; edit: [] }>();
const confirming = ref(false);
const { t } = useI18n();
// Pull down to close, push up to edit (when the appointment can be edited).
const sheetEl = ref<HTMLElement | null>(null);
useSheetDrag(sheetEl, { onClose: () => emit('close'), onUp: props.canDelete ? () => emit('edit') : undefined });

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
const mapUrl = computed(() => mapsUrl(props.event.location ?? ''));

// --- When to leave: from where the user is now, by car, with a traffic margin and time to park (server/src/travel.ts).
interface Leave { routeMin: number; km: number; place: string }
const leave = ref<Leave | null>(null);
// Time to park, chosen per appointment (0–20 min): the departure is recomputed at once, the route is not asked again.
const parkKey = props.event.id ?? `${props.event.title}|${props.event.start}`;
const parking = ref(parkingFor(parkKey));
function chooseParking(min: number) {
  parking.value = min;
  setParking(parkKey, min);
}
const plan = computed(() => (leave.value ? departure(Date.parse(props.event.start), leave.value.routeMin, parking.value) : null));
const leaveState = ref<'idle' | 'locating' | 'error'>('idle');
const leaveError = ref('');
/** Timed appointments with a place, from now to a week ahead. */
const canLeave = computed(() => {
  const e = props.event;
  const start = Date.parse(e.start);
  return Boolean(!e.allDay && e.location?.trim() && start > Date.now() && start - Date.now() < 7 * 86400_000);
});
const hm = (ts: number) => new Date(ts).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
const late = computed(() => Boolean(plan.value && plan.value.leaveAt <= Date.now()));
async function whenToLeave() {
  leaveState.value = 'locating';
  try {
    const from = await currentPosition().catch(() => {
      throw new Error(t('agenda.leave.noPos'));
    });
    leave.value = await post<Leave>('/api/travel', { from, to: props.event.location, start: props.event.start, parkingMin: parking.value });
    leaveState.value = 'idle';
  } catch (e) {
    leaveError.value = (e as Error).message;
    leaveState.value = 'error';
  }
}

const onKey = (e: KeyboardEvent) => e.key === 'Escape' && emit('close');
onMounted(() => {
  window.addEventListener('keydown', onKey);
  if (canLeave.value && (here.value || positionState.value === 'granted')) void whenToLeave();
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="sheet-backdrop" @click.self="emit('close')">
    <article ref="sheetEl" class="sheet rise" role="dialog" aria-modal="true" :aria-label="event.title">
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
      <section v-if="canLeave" class="ev-leave" :aria-label="t('agenda.leave.ask')" aria-live="polite">
        <template v-if="leave && plan">
          <p :class="['ev-leave-at', { late }]"><Icon name="clock" :size="18" /> {{ late ? t('agenda.leave.late', { time: hm(plan.leaveAt) }) : t('agenda.leave.at', { time: hm(plan.leaveAt) }) }}</p>
          <p class="muted ev-leave-detail">{{ t('agenda.leave.detail', { drive: plan.driveMin, km: leave.km.toLocaleString(dateLocale()), margin: plan.marginMin, park: plan.parkingMin }) }}</p>
          <div class="ev-park" role="radiogroup" :aria-label="t('agenda.leave.park')">
            <span class="eyebrow">{{ t('agenda.leave.park') }}</span>
            <span class="ev-park-choices">
              <button v-for="m in PARKING_CHOICES" :key="m" type="button" role="radio" :aria-checked="parking === m" :class="{ on: parking === m }" @click="chooseParking(m)">{{ m }}</button>
              <span class="muted" style="font-size: 12px">min</span>
            </span>
          </div>
          <span style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center">
            <a class="btn" :href="directionsUrl(leave.place)" target="_blank" rel="noopener noreferrer"><Icon name="pin" :size="16" /> {{ t('agenda.leave.route') }}</a>
            <button type="button" class="btn" @click="whenToLeave"><Icon name="refresh" :size="16" /> {{ t('agenda.leave.again') }}</button>
          </span>
          <p class="muted" style="margin: 0; font-size: 12px">{{ t('agenda.leave.note') }}</p>
        </template>
        <button v-else type="button" class="btn" :disabled="leaveState === 'locating'" @click="whenToLeave">
          <Icon name="clock" :size="16" /> {{ leaveState === 'locating' ? t('agenda.leave.locating') : t('agenda.leave.ask') }}
        </button>
        <p v-if="leaveState === 'error'" class="ev-warn" style="margin: 0">{{ leaveError }}</p>
      </section>
      <p v-if="event.fromMail" class="muted" style="margin: 0; font-size: 14px">{{ event.fromMail }}</p>
      <div v-if="event.description" class="ev-desc">{{ event.description }}</div>
      <template v-if="canDelete">
        <span v-if="!confirming" style="display: flex; flex-wrap: wrap; gap: 8px">
          <button type="button" class="btn btn-prim" @click="emit('edit')"><Icon name="pen" :size="16" /> {{ t('agenda.edit') }}</button>
          <button type="button" class="btn btn-danger" @click="confirming = true"><Icon name="trash" :size="16" /> {{ t('agenda.delete') }}</button>
        </span>
        <div v-else class="ev-confirm" role="alert">
          <p>{{ t('agenda.deleteConfirm') }}</p>
          <span style="display: flex; gap: 8px; flex-wrap: wrap">
            <button type="button" class="btn" @click="confirming = false">{{ t('common.cancel') }}</button>
            <button type="button" class="btn btn-danger" :disabled="busy" @click="emit('delete')"><Icon name="trash" :size="16" /> {{ t('agenda.deleteYes') }}</button>
          </span>
        </div>
      </template>
    </article>
  </div>
</template>
