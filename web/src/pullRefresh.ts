import { onActivated, onDeactivated, onMounted, onUnmounted, ref, type Ref } from 'vue';
import { axis, pullOffset, pullTriggers } from './gestures.ts';

/**
 * Pull to refresh on a touch screen: dragging the page down while it is scrolled to the top shows an indicator that
 * follows the finger; let go far enough and `onRefresh` runs. Active only while the screen is shown (KeepAlive),
 * and not over a sheet or when `disabled` says so (a mail open on the phone).
 */
export function usePullRefresh(onRefresh: () => void, disabled: Ref<boolean>) {
  const offset = ref(0);
  const armed = ref(false);
  let start: { x: number; y: number } | null = null;
  let owned = false;

  function onStart(e: TouchEvent) {
    const target = e.target as HTMLElement | null;
    if (disabled.value || e.touches.length !== 1 || window.scrollY > 0 || target?.closest('.sheet, .sheet-backdrop, .appmenu-backdrop, input, textarea')) return;
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    owned = false;
  }
  function onMove(e: TouchEvent) {
    if (!start) return;
    const dx = e.touches[0].clientX - start.x;
    const dy = e.touches[0].clientY - start.y;
    if (!owned) {
      const a = axis(dx, dy);
      if (!a) return;
      if (a === 'x' || dy < 0) {
        start = null; // a row swipe, or a scroll down the list
        return;
      }
      owned = true;
    }
    e.preventDefault(); // no rubber band behind the indicator
    offset.value = pullOffset(dy);
    armed.value = pullTriggers(dy);
  }
  function onEnd() {
    if (!start) return;
    start = null;
    if (owned && armed.value) onRefresh();
    owned = false;
    offset.value = 0;
    armed.value = false;
  }

  const coarse = () => matchMedia('(pointer: coarse)').matches;
  function on() {
    if (!coarse()) return;
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
  }
  function off() {
    document.removeEventListener('touchstart', onStart);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
    document.removeEventListener('touchcancel', onEnd);
    start = null;
    offset.value = 0;
  }
  onMounted(on);
  onActivated(() => {
    off();
    on();
  });
  onDeactivated(off);
  onUnmounted(off);
  return { offset, armed };
}
