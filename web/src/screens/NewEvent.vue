<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, post } from '../api.ts';
import { mapsUrl } from '../maps.ts';
import { useSheetDrag } from '../sheetDrag.ts';
import Icon from '../components/Icon.vue';
import { notify, notifyError } from '../store.ts';

/**
 * Appointment sheet: title, all day or times (the end follows the start), place with French address suggestions
 * (Base Adresse Nationale), reminder and notes. Bottom sheet on the phone, dialog on the computer.
 */
const props = defineProps<{
  day?: string;
  time?: string;
  /** Appointment to edit (form pre-filled, saved in place). */
  event?: { id?: string; title: string; start: string; end: string; allDay: boolean; location?: string | null; description?: string | null; calendar?: { id?: string } };
  calendars?: { id: string; name: string; color: string; primary: boolean }[] }>();
const emit = defineEmits<{ done: []; close: [] }>();
// Pulled down by its grip bar (the fields need the rest of the sheet), the form closes.
const sheetEl = ref<HTMLElement | null>(null);
useSheetDrag(sheetEl, { onClose: () => emit('close'), fromTop: true });
const { t } = useI18n();

const localDay = (d: Date) => d.toLocaleDateString('sv-SE');
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localDay(d);
};
const tomorrow = addDays(localDay(new Date()), 1);

const ev = props.event;
const hmOf = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const title = ref(ev?.title ?? '');
const allDay = ref(ev?.allDay ?? false);
const startDay = ref(ev ? (ev.allDay ? ev.start : localDay(new Date(ev.start))) : (props.day ?? tomorrow));
const endDay = ref(ev ? (ev.allDay ? addDays(ev.end, -1) : localDay(new Date(ev.end))) : (props.day ?? tomorrow));
const from = ref(ev && !ev.allDay ? hmOf(ev.start) : (props.time ?? '10:00'));
const to = ref(ev && !ev.allDay ? hmOf(ev.end) : props.time ? `${String(Math.min(23, Number(props.time.slice(0, 2)) + 1)).padStart(2, '0')}:${props.time.slice(3, 5)}` : '11:00');
const place = ref(ev?.location ?? '');
const coords = ref<{ lat: number; lon: number } | null>(null);
/** 'keep' leaves the reminder of an edited appointment as it is. */
const reminder = ref<number | null | 'keep'>(ev ? 'keep' : 30);
const notes = ref(ev?.description ?? '');
const calendarId = ref(props.calendars?.find((c) => c.primary)?.id ?? props.calendars?.[0]?.id ?? '');
const busy = ref(false);
const REMINDERS: (number | null | 'keep')[] = [...(ev ? ['keep' as const] : []), null, 10, 30, 60, 1440];

/** Local date + time → RFC 3339 with the browser's UTC offset. */
function toIso(day: string, hm: string): string {
  const off = -new Date(`${day}T${hm}:00`).getTimezoneOffset();
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${day}T${hm}:00${off >= 0 ? '+' : '-'}${pad(off / 60)}:${pad(off % 60)}`;
}
const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Moving the start moves the end with it, keeping the length of the appointment.
watch(startDay, (d, old) => {
  const span = Math.round((Date.parse(`${endDay.value}T12:00:00`) - Date.parse(`${old}T12:00:00`)) / 86_400_000);
  endDay.value = addDays(d, Math.max(0, span));
});
watch(from, (f, old) => {
  if (startDay.value !== endDay.value) return;
  const length = Math.max(15, minutes(to.value) - minutes(old));
  to.value = hm(Math.min(minutes(f) + length, 23 * 60 + 59));
});

const valid = computed(() => {
  if (!title.value.trim() || endDay.value < startDay.value) return false;
  return allDay.value || Date.parse(toIso(endDay.value, to.value)) > Date.parse(toIso(startDay.value, from.value));
});

async function submit() {
  if (!valid.value) return;
  busy.value = true;
  try {
    const payload = {
      title: title.value.trim(),
      allDay: allDay.value,
      start: allDay.value ? startDay.value : toIso(startDay.value, from.value),
      end: allDay.value ? addDays(endDay.value, 1) : toIso(endDay.value, to.value),
      location: place.value.trim() || null,
      description: notes.value.trim() || (ev ? '' : undefined),
      reminderMin: reminder.value === 'keep' || reminder.value === null ? undefined : reminder.value,
    };
    if (ev?.id && ev.calendar?.id) {
      await api(`/api/agenda/events/${encodeURIComponent(ev.calendar.id)}/${encodeURIComponent(ev.id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify(t('agenda.updatedToast', { title: payload.title }));
      emit('done');
      return;
    }
    await post('/api/agenda/events', {
      ...payload,
      calendarId: (props.calendars?.length ?? 0) > 1 && calendarId.value ? calendarId.value : undefined,
    });
    notify(t('agenda.addedToast', { title: title.value.trim() }));
    emit('done');
  } catch (e) {
    notifyError(e);
  } finally {
    busy.value = false;
  }
}

// --- Place: as you type, named places (a shop, a chain, a pharmacy…, from OpenStreetMap) and French addresses.
interface Address { kind: 'address' | 'place'; label: string; context: string; lat: number; lon: number }
const suggestions = ref<Address[]>([]);
const active = ref(-1);
const addrError = ref('');
let timer = 0;
let lastQuery = '';
function onPlaceInput() {
  coords.value = null;
  window.clearTimeout(timer);
  const q = place.value.trim();
  if (q.length < 3) {
    suggestions.value = [];
    return;
  }
  timer = window.setTimeout(async () => {
    lastQuery = q;
    try {
      const r = await api<Address[]>(`/api/address?q=${encodeURIComponent(q)}`);
      if (lastQuery !== q) return;
      suggestions.value = r;
      active.value = -1;
      addrError.value = '';
    } catch {
      suggestions.value = [];
      addrError.value = t('agenda.form.addrDown');
    }
  }, 250);
}
function pick(a: Address) {
  place.value = a.label;
  coords.value = Number.isFinite(a.lat) ? { lat: a.lat, lon: a.lon } : null;
  suggestions.value = [];
}
function onPlaceKey(e: KeyboardEvent) {
  if (!suggestions.value.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = suggestions.value.length;
    active.value = (active.value + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
  } else if (e.key === 'Enter' && active.value >= 0) {
    e.preventDefault();
    pick(suggestions.value[active.value]);
  } else if (e.key === 'Escape') {
    e.stopPropagation();
    suggestions.value = [];
  }
}
const mapUrl = computed(() => (coords.value ? mapsUrl(place.value, coords.value) : ''));

const onKey = (e: KeyboardEvent) => e.key === 'Escape' && emit('close');
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  window.clearTimeout(timer);
});
</script>

<template>
  <div class="sheet-backdrop" @click.self="emit('close')">
    <form ref="sheetEl" class="sheet rise" role="dialog" aria-modal="true" :aria-label="t('agenda.newEvent')" @submit.prevent="submit">
      <div class="sheet-grip" aria-hidden="true" />
      <header class="sheet-head">
        <button type="button" class="linkish" @click="emit('close')">{{ t('common.cancel') }}</button>
        <span class="eyebrow">{{ ev ? t('agenda.editEvent') : t('agenda.newEvent') }}</span>
        <button class="btn btn-prim" :disabled="busy || !valid">{{ busy ? t('agenda.form.adding') : ev ? t('agenda.form.save') : t('agenda.form.add') }}</button>
      </header>

      <label class="sr" for="ev-title">{{ t('agenda.form.title') }}</label>
      <input id="ev-title" v-model="title" class="ev-title" required autocomplete="off" :placeholder="t('agenda.form.titlePh')" />

      <section class="ev-group" :aria-label="t('agenda.form.when')">
        <label class="ev-line switch">
          <span class="ev-label"><Icon name="calendar" :size="16" /> {{ t('agenda.allDay') }}</span>
          <input id="ev-allday" v-model="allDay" type="checkbox" />
        </label>
        <div class="ev-line">
          <span class="ev-label">{{ t('agenda.form.start') }}</span>
          <span class="ev-pair">
            <input id="ev-start-day" v-model="startDay" type="date" class="field-input" required :aria-label="t('agenda.form.startDay')" />
            <input v-if="!allDay" id="ev-start-time" v-model="from" type="time" class="field-input" required :aria-label="t('agenda.form.startTime')" />
          </span>
        </div>
        <div class="ev-line">
          <span class="ev-label">{{ t('agenda.form.end') }}</span>
          <span class="ev-pair">
            <input id="ev-end-day" v-model="endDay" type="date" class="field-input" :min="startDay" required :aria-label="t('agenda.form.endDay')" />
            <input v-if="!allDay" id="ev-end-time" v-model="to" type="time" class="field-input" required :aria-label="t('agenda.form.endTime')" />
          </span>
        </div>
        <p v-if="!valid && title.trim()" class="ev-warn">{{ t('agenda.form.endBefore') }}</p>
      </section>

      <section class="ev-group">
        <div class="ev-place">
          <label class="ev-label" for="ev-place">{{ t('agenda.form.placeLabel') }}</label>
          <input
            id="ev-place"
            v-model="place"
            class="field-input"
            autocomplete="off"
            role="combobox"
            aria-autocomplete="list"
            :aria-expanded="suggestions.length > 0"
            aria-controls="ev-addr"
            :placeholder="t('agenda.form.placePh')"
            @input="onPlaceInput"
            @keydown="onPlaceKey"
          />
          <ul v-if="suggestions.length" id="ev-addr" class="addr-list" role="listbox">
            <li v-for="(a, i) in suggestions" :key="a.label + i" role="option" :aria-selected="i === active">
              <button type="button" @click="pick(a)">
                <strong><Icon :name="a.kind === 'place' ? 'store' : 'pin'" :size="13" /> {{ a.label }}</strong><span>{{ a.context }}</span>
              </button>
            </li>
          </ul>
          <p v-if="addrError" class="ev-warn">{{ addrError }}</p>
          <a v-if="mapUrl" class="ev-map" :href="mapUrl" target="_blank" rel="noopener noreferrer"><Icon name="arrow" :size="14" /> {{ t('agenda.form.seeMap') }}</a>
          <span class="muted" style="font-size: 11px">{{ t('agenda.form.addrSource') }}</span>
        </div>
      </section>

      <section class="ev-group">
        <label v-if="!ev && (calendars?.length ?? 0) > 1" class="ev-line">
          <span class="ev-label"><i class="cal-dot" :style="{ background: calendars?.find((c) => c.id === calendarId)?.color }" aria-hidden="true" /> {{ t('agenda.form.calendar') }}</span>
          <select id="ev-calendar" v-model="calendarId" class="select">
            <option v-for="c in calendars" :key="c.id" :value="c.id">{{ c.primary ? t('agenda.mine') : c.name }}</option>
          </select>
        </label>
        <label class="ev-line">
          <span class="ev-label"><Icon name="bell" :size="16" /> {{ t('agenda.form.reminder') }}</span>
          <select id="ev-reminder" v-model="reminder" class="select">
            <option v-for="r in REMINDERS" :key="String(r)" :value="r">{{ t(`agenda.form.reminders.${r ?? 'none'}`) }}</option>
          </select>
        </label>
        <label class="ev-notes">
          <span class="ev-label">{{ t('agenda.form.notes') }}</span>
          <textarea id="ev-notes" v-model="notes" rows="3" class="plain" :placeholder="t('agenda.form.notesPh')" />
        </label>
      </section>
    </form>
  </div>
</template>
