<script setup lang="ts">
import { computed, ref } from 'vue';
import { logoFor } from '../logos.ts';

/** The sender at the start of a row: their organisation's logo, or their initial on a colour of their own. */
const props = defineProps<{ name: string; email: string; tag?: string }>();
const broken = ref(false);
const logo = computed(() => (broken.value ? null : logoFor(props.email)));
const initial = computed(() => (props.name || props.email).replace(/^[^\p{L}\p{N}]+/u, '').charAt(0).toUpperCase() || '?');
const hue = computed(() => [...props.email.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
</script>

<template>
  <span class="avatar" aria-hidden="true">
    <img v-if="logo" :src="logo" alt="" @error="broken = true" />
    <span v-else class="avatar-initial" :style="{ '--h': hue }">{{ initial }}</span>
    <i v-if="tag" class="avatar-tag" :style="{ background: tag }" />
  </span>
</template>
