<script setup lang="ts">
import { C_PATH, ENVELOPE as E, INK, LIME, SEAL } from '../logo.ts';

/** Calm's mark on its lime tile, the same drawing as the app icons (src/logo.ts). Sized by its container; the seal pulses while busy. */
defineProps<{ busy?: boolean }>();
</script>

<template>
  <svg viewBox="0 0 512 512" aria-hidden="true" :class="['logo-mark', { busy }]">
    <rect width="512" height="512" rx="112" :fill="LIME" />
    <path :d="C_PATH" :fill="INK" />
    <g class="seal" :style="{ transformOrigin: `${SEAL.cx}px ${SEAL.cy}px` }">
      <circle :cx="SEAL.cx" :cy="SEAL.cy" :r="SEAL.r" :fill="INK" />
      <g :stroke="LIME" :stroke-width="E.stroke" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <rect :x="E.rect.x" :y="E.rect.y" :width="E.rect.w" :height="E.rect.h" :rx="E.rect.rx" />
        <path :d="E.flap" />
      </g>
    </g>
  </svg>
</template>
