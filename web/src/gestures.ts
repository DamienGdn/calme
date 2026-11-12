/** Touch gesture rules (pure, so they are testable): swipe a mail to mark it unread or trash it, swipe an open mail to go back. */

const LOCK_PX = 10;

/** Decides once, after a real move, whether a drag is ours (horizontal) or the page's scroll (vertical). */
export function axis(dx: number, dy: number): 'x' | 'y' | null {
  if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return null;
  return Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
}

const flick = (dx: number, ms: number, min: number) => dx > min && dx / Math.max(ms, 1) > 0.5;

/**
 * A mail dragged past a third of its width, or flicked: to the right it switches read / unread, to the left it goes
 * to the trash (like Apple Mail).
 */
export function swipeAction(dx: number, width: number, ms: number): 'read' | 'trash' | null {
  const d = Math.abs(dx);
  if (!(d > width / 3 || flick(d, ms, 60))) return null;
  return dx > 0 ? 'read' : 'trash';
}

/** An open mail swiped to the right goes back to the list. */
export function swipeBack(dx: number, width: number, ms: number): boolean {
  return dx > 0 && (dx > Math.min(120, width * 0.3) || flick(dx, ms, 50));
}

/**
 * A sheet (popup) dragged vertically: pulled down past a quarter of its height (120 px at most) or flicked down, it
 * closes; pushed up 80 px or flicked up, it goes to its next step (an appointment opens for editing).
 */
export function sheetSwipe(dy: number, ms: number, height: number): 'down' | 'up' | null {
  if (dy > 0 && (dy > Math.min(120, height / 4) || flick(dy, ms, 50))) return 'down';
  if (dy < 0 && (-dy > 80 || flick(-dy, ms, 50))) return 'up';
  return null;
}

/** Pull to refresh: the indicator follows half the finger's travel (90 px at most); 120 px of travel fetches mail. */
export const pullOffset = (dy: number) => Math.min(90, Math.max(0, dy / 2));
export const pullTriggers = (dy: number) => dy >= 120;
