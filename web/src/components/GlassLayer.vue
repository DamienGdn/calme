<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

/**
 * The light of a liquid-glass shape, drawn in WebGL over its frosted backdrop (after clayharmon/webgl-liquid-glass,
 * MIT): a bright rim where the edge faces the light, a soft bevel inside the edge, a little shade on the far side,
 * and for the selected tab a lens with a coloured fringe at its edge. The backdrop itself (blur, tint) stays CSS, so
 * this works on every browser with WebGL, iPhone included; without WebGL the frosted glass alone remains.
 *
 * The canvas fills its parent (a rounded shape, radius = half its height). `pill` is the element of the selected
 * tab: its position is read while it moves (CSS transition), so the lens follows it.
 */
const props = defineProps<{ pill?: HTMLElement | null; dark: boolean; moving?: number }>();
const canvas = ref<HTMLCanvasElement | null>(null);

const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_dpr;
uniform vec4 u_bar;
uniform vec4 u_pill;
uniform float u_pillOn;
uniform vec2 u_light;
uniform float u_dark;
float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 f = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_dpr;
  vec2 pb = f - u_bar.xy;
  float rb = min(u_bar.z, u_bar.w);
  float db = box(pb, u_bar.zw, rb);
  float inside = 1.0 - smoothstep(-0.8, 0.6, db);
  vec2 nb = normalize(pb / max(u_bar.zw, vec2(1.0)) + 1e-4);
  float lit = dot(nb, -u_light) * 0.5 + 0.5;
  float rim = smoothstep(1.6, 0.0, abs(db + 0.9));
  float bevel = smoothstep(9.0, 0.0, -db) * inside;
  float strength = mix(1.0, 0.65, u_dark);
  float a = rim * (0.18 + 0.62 * pow(lit, 3.0)) * strength + bevel * 0.10 * pow(lit, 2.0) * strength;
  float shade = bevel * mix(0.10, 0.22, u_dark) * pow(1.0 - lit, 2.0);
  vec3 c = vec3(1.0);
  c.r += rim * 0.35 * nb.x;
  c.b -= rim * 0.35 * nb.x;
  vec2 pp = f - u_pill.xy;
  float rp = min(u_pill.z, u_pill.w);
  float dp = box(pp, u_pill.zw, rp);
  float pin = (1.0 - smoothstep(-0.8, 0.6, dp)) * u_pillOn;
  vec2 np = pp / max(u_pill.zw, vec2(1.0));
  float plit = dot(normalize(np + 1e-4), -u_light) * 0.5 + 0.5;
  float prim = smoothstep(1.4, 0.0, abs(dp + 0.8)) * u_pillOn;
  float fringe = smoothstep(0.45, 1.0, length(np)) * pin;
  float pa = prim * (0.22 + 0.55 * pow(plit, 3.0)) * strength + pin * (0.05 + 0.10 * pow(plit, 4.0)) + pin * (1.0 - dot(np, np)) * 0.04;
  vec3 pc = vec3(1.0 + fringe * 0.9 * np.x, 1.0 + fringe * 0.25 * abs(np.y), 1.0 - fringe * 0.9 * np.x);
  float alpha = clamp(a + pa, 0.0, 0.7) * inside;
  vec3 light = (c * a + pc * pa) / max(a + pa, 1e-4);
  float sh = clamp(shade, 0.0, 0.3) * inside;
  gl_FragColor = vec4(clamp(light, 0.0, 1.0) * alpha, clamp(alpha + sh, 0.0, 0.8));
}`;
const VERT = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';

let gl: WebGLRenderingContext | null = null;
let prog: WebGLProgram | null = null;
let u: Record<string, WebGLUniformLocation | null> = {};
let raf = 0;
let until = 0;
let observer: ResizeObserver | null = null;

function setup(): boolean {
  const c = canvas.value;
  if (!c) return false;
  gl = c.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: true });
  if (!gl) return false;
  const sh = (type: number, src: string) => {
    const s = gl!.createShader(type)!;
    gl!.shaderSource(s, src);
    gl!.compileShader(s);
    return s;
  };
  prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  for (const k of ['u_res', 'u_dpr', 'u_bar', 'u_pill', 'u_pillOn', 'u_light', 'u_dark']) u[k] = gl.getUniformLocation(prog, k);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  return true;
}

function draw() {
  const c = canvas.value;
  if (!gl || !c) return;
  const r = c.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform2f(u.u_res, w, h);
  gl.uniform1f(u.u_dpr, dpr);
  gl.uniform4f(u.u_bar, r.width / 2, r.height / 2, r.width / 2, r.height / 2);
  const p = props.pill?.getBoundingClientRect();
  if (p && p.width > 1) gl.uniform4f(u.u_pill, p.left - r.left + p.width / 2, p.top - r.top + p.height / 2, p.width / 2, p.height / 2);
  gl.uniform1f(u.u_pillOn, p && p.width > 1 ? 1 : 0);
  // Light from the top left, as on iOS.
  gl.uniform2f(u.u_light, 0.45, 0.89);
  gl.uniform1f(u.u_dark, props.dark ? 1 : 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/** Redraws every frame for a while (a tab change, the bar shrinking), then rests. */
function animate(ms = 650) {
  until = Math.max(until, performance.now() + ms);
  if (raf) return;
  const step = () => {
    draw();
    raf = performance.now() < until ? requestAnimationFrame(step) : 0;
  };
  raf = requestAnimationFrame(step);
}

const lost = (e: Event) => e.preventDefault();
const restored = () => {
  if (setup()) animate(50);
};
onMounted(() => {
  if (!setup()) {
    if (canvas.value) canvas.value.style.display = 'none';
    return;
  }
  canvas.value!.addEventListener('webglcontextlost', lost);
  canvas.value!.addEventListener('webglcontextrestored', restored);
  observer = new ResizeObserver(() => animate(120));
  observer.observe(canvas.value!);
  animate(100);
});
watch(() => [props.pill, props.dark, props.moving], () => animate());
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  observer?.disconnect();
  canvas.value?.removeEventListener('webglcontextlost', lost);
  canvas.value?.removeEventListener('webglcontextrestored', restored);
});
</script>

<template>
  <canvas ref="canvas" class="glass-layer" aria-hidden="true" />
</template>
