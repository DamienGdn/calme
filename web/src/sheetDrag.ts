import { onBeforeUnmount, onMounted, type Ref } from 'vue';
import { axis, sheetSwipe } from './gestures.ts';

/**
 * Touch drag on a sheet (popup), like iOS: the sheet follows the finger, pulled down it closes, pushed up it calls
 * `onUp` (an appointment opens for editing). A drag only belongs to the sheet when its content cannot scroll that way
 * (scrolled to the top to pull down, to the bottom to push up); otherwise the content scrolls as usual.
 * `fromTop`: only a drag started on the grip bar (the sheet's top 56 px) counts — for forms, whose fields need the
 * rest of the sheet.
 */
export function useSheetDrag(el: Ref<HTMLElement | null>, opts: { onClose: () => void; onUp?: () => void; fromTop?: boolean }) {
  let start: { x: number; y: number; t: number; down: boolean; up: boolean } | null = null;
  let owned = false;
  let dy = 0;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function place(y: number, animate: boolean) {
    const s = el.value;
    if (!s) return;
    s.style.transition = animate && !reduced() ? 'transform 0.2s ease-out' : 'none';
    s.style.transform = y ? `translateY(${y}px)` : '';
  }

  function onStart(e: TouchEvent) {
    const s = el.value;
    if (!s || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const field = (e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]');
    if (field || (opts.fromTop && touch.clientY - s.getBoundingClientRect().top > 56)) return;
    start = {
      x: touch.clientX,
      y: touch.clientY,
      t: performance.now(),
      down: s.scrollTop <= 0,
      up: Boolean(opts.onUp) && s.scrollTop + s.clientHeight >= s.scrollHeight - 2,
    };
    owned = false;
    dy = 0;
  }

  function onMove(e: TouchEvent) {
    if (!start) return;
    const touch = e.touches[0];
    const dx = touch.clientX - start.x;
    dy = touch.clientY - start.y;
    if (!owned) {
      const a = axis(dx, dy);
      if (!a) return;
      if (a === 'x' || (dy > 0 && !start.down) || (dy < 0 && !start.up)) {
        start = null; // the content's own scroll
        return;
      }
      owned = true;
    }
    e.preventDefault();
    place(dy > 0 ? dy : dy * 0.35, false); // pushing up resists, like a rubber band
  }

  function onEnd() {
    if (!start) return;
    const was = start;
    start = null;
    if (!owned) return;
    const s = el.value;
    const result = sheetSwipe(dy, performance.now() - was.t, s?.offsetHeight ?? 600);
    if (result === 'down' && was.down) {
      place(s?.offsetHeight ?? 600, true);
      window.setTimeout(opts.onClose, reduced() ? 0 : 180);
    } else {
      place(0, true);
      if (result === 'up' && was.up) opts.onUp?.();
    }
  }

  onMounted(() => {
    const s = el.value;
    if (!s) return;
    s.addEventListener('touchstart', onStart, { passive: true });
    s.addEventListener('touchmove', onMove, { passive: false });
    s.addEventListener('touchend', onEnd);
    s.addEventListener('touchcancel', onEnd);
  });
  onBeforeUnmount(() => {
    const s = el.value;
    if (!s) return;
    s.removeEventListener('touchstart', onStart);
    s.removeEventListener('touchmove', onMove);
    s.removeEventListener('touchend', onEnd);
    s.removeEventListener('touchcancel', onEnd);
  });
}
