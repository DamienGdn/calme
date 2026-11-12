<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { axis, swipeAction } from '../gestures.ts';
import Icon from './Icon.vue';

/**
 * A list row for touch screens, like Apple Mail: swiped right it switches read / unread (and springs back), swiped
 * left it goes to the trash; a long press starts a selection. Vertical drags stay the page's scroll. The click that
 * ends a swipe or a long press is swallowed.
 */
defineProps<{ trashLabel: string; readLabel: string }>();
const emit = defineEmits<{ trash: []; read: []; hold: [] }>();

const dx = ref(0);
const dragging = ref(false);
let start: { x: number; y: number; t: number } | null = null;
let lock: 'x' | 'y' | null = null;
let holdTimer = 0;
let swallow = false;
let resetTimer = 0;

function down(e: PointerEvent) {
  if (e.pointerType !== 'touch') return;
  start = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  lock = null;
  swallow = false;
  holdTimer = window.setTimeout(() => {
    swallow = true;
    start = null;
    navigator.vibrate?.(10);
    emit('hold');
  }, 500);
}

function move(e: PointerEvent) {
  if (!start) return;
  const ddx = e.clientX - start.x;
  const ddy = e.clientY - start.y;
  if (Math.hypot(ddx, ddy) > 10) window.clearTimeout(holdTimer);
  lock ??= axis(ddx, ddy);
  if (lock === 'x') {
    dragging.value = true;
    swallow = true;
    dx.value = ddx;
  } else if (lock === 'y') start = null;
}

function up(e: PointerEvent) {
  window.clearTimeout(holdTimer);
  dragging.value = false;
  if (!start || lock !== 'x') {
    start = null;
    dx.value = 0;
    return;
  }
  const width = (e.currentTarget as HTMLElement).offsetWidth;
  const go = swipeAction(e.clientX - start.x, width, e.timeStamp - start.t);
  start = null;
  if (go !== 'trash') {
    dx.value = 0;
    if (go === 'read') {
      navigator.vibrate?.(10);
      emit('read');
    }
    return;
  }
  dx.value = -width;
  window.setTimeout(() => emit('trash'), 160);
  // If the trash fails the row is still here: bring it back.
  resetTimer = window.setTimeout(() => (dx.value = 0), 2500);
}

function cancel() {
  window.clearTimeout(holdTimer);
  start = null;
  dragging.value = false;
  dx.value = 0;
}

function click(e: MouseEvent) {
  if (!swallow) return;
  swallow = false;
  e.preventDefault();
  e.stopPropagation();
}

onBeforeUnmount(() => {
  window.clearTimeout(holdTimer);
  window.clearTimeout(resetTimer);
});
</script>

<template>
  <div :class="['swipe', { swiping: dx !== 0 }]" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="cancel" @click.capture="click" @contextmenu="swallow && $event.preventDefault()">
    <div v-if="dx > 0" class="swipe-bg read" aria-hidden="true" :style="{ opacity: Math.min(1, dx / 80) }"><Icon name="mail" :size="18" /> {{ readLabel }}</div>
    <div v-else class="swipe-bg" aria-hidden="true" :style="{ opacity: Math.min(1, -dx / 80) }">{{ trashLabel }} <Icon name="trash" :size="18" /></div>
    <div :class="['swipe-fg', { moving: dx !== 0 }]" :style="{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dragging ? 'none' : 'transform 0.18s ease' }">
      <slot />
    </div>
  </div>
</template>
