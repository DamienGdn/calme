<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api.ts';

/**
 * Recipient field with chips and suggestions from the local contact book.
 * The model is a comma-separated list of addresses (what the send API expects).
 */
const props = defineProps<{ label: string; required?: boolean }>();
const model = defineModel<string>({ required: true });
const { t } = useI18n();

interface Contact {
  name: string;
  email: string;
  sent: number;
  received: number;
}

const EMAIL = /^[^\s@<>(),;]+@[^\s@<>(),;]+\.[^\s@<>(),;]+$/;
const id = useId();
const text = ref('');
const list = ref<Contact[]>([]);
const open = ref(false);
const active = ref(0);
const names = new Map<string, string>();
const chips = computed(() => model.value.split(',').map((x) => x.trim()).filter(Boolean));

let timer = 0;
watch([text, open, model], () => {
  if (!open.value) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    api<Contact[]>(`/api/contacts?q=${encodeURIComponent(text.value.trim())}&limit=8`)
      .then((l) => {
        list.value = l.filter((c) => !chips.value.includes(c.email));
        active.value = 0;
      })
      .catch(() => (list.value = []));
  }, 150);
});

function add(email: string, name?: string) {
  const e = email.trim().toLowerCase();
  if (!EMAIL.test(e) || chips.value.includes(e)) return;
  if (name) names.set(e, name);
  model.value = [...chips.value, e].join(', ');
  text.value = '';
  // A person was picked: the list closes; tapping the field again (or typing) brings it back.
  open.value = false;
}
const inputEl = ref<HTMLInputElement | null>(null);
/** A tap on the empty part of the field focuses it and shows the suggestions again. */
function reopen(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('.rchip')) return;
  inputEl.value?.focus();
  open.value = true;
}
const removeChip = (c: string) => (model.value = chips.value.filter((x) => x !== c).join(', '));

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' && list.value.length) {
    e.preventDefault();
    active.value = (active.value + 1) % list.value.length;
  } else if (e.key === 'ArrowUp' && list.value.length) {
    e.preventDefault();
    active.value = (active.value - 1 + list.value.length) % list.value.length;
  } else if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
    const pick = list.value[active.value];
    if (open.value && pick && text.value.trim()) {
      e.preventDefault();
      add(pick.email, pick.name);
    } else if (EMAIL.test(text.value.trim())) {
      e.preventDefault();
      add(text.value);
    }
  } else if (e.key === 'Backspace' && !text.value && chips.value.length) {
    model.value = chips.value.slice(0, -1).join(', ');
  } else if (e.key === 'Escape') open.value = false;
}

function onBlur() {
  window.setTimeout(() => (open.value = false), 150);
  if (EMAIL.test(text.value.trim())) add(text.value);
}
</script>

<template>
  <div class="line recipients">
    <label class="eyebrow" :for="id">{{ props.label }}</label>
    <div class="chips" @click="reopen">
      <span v-for="c in chips" :key="c" class="rchip" :title="c">
        {{ names.get(c) ?? c }}
        <button type="button" :aria-label="t('common.remove', { name: c })" @click="removeChip(c)">×</button>
      </span>
      <input
        :id="id"
        ref="inputEl"
        v-model="text"
        role="combobox"
        :aria-expanded="open && list.length > 0"
        :aria-controls="`${id}-list`"
        aria-autocomplete="list"
        :aria-activedescendant="open && list[active] ? `${id}-${active}` : undefined"
        :required="props.required && !chips.length"
        :placeholder="chips.length ? '' : t('editor.recipientPlaceholder')"
        autocomplete="off"
        @input="open = true"
        @focus="open = true"
        @blur="onBlur"
        @keydown="onKey"
      />
    </div>
    <ul v-if="open && list.length" :id="`${id}-list`" role="listbox" class="suggest">
      <li
        v-for="(c, i) in list"
        :id="`${id}-${i}`"
        :key="c.email"
        role="option"
        :aria-selected="i === active"
        @mousedown.prevent="add(c.email, c.name)"
      >
        <span style="font-weight: 500">{{ c.name }}</span>
        <span class="mono muted" style="font-size: 12px">{{ c.email }}</span>
        <span class="muted" style="margin-left: auto; font-size: 11px">
          {{ c.sent ? t('editor.wroteTimes', { n: c.sent }) : t('editor.receivedTimes', { n: c.received }) }}
        </span>
      </li>
    </ul>
  </div>
</template>
