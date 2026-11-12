/** Dates for reminders: the quick choices offered when noting one, and the groups the list is shown in. */

export type DueKey = 'tonight' | 'tomorrow' | 'weekend' | 'nextWeek' | 'inWeek';
export type DueGroup = 'late' | 'today' | 'soon' | 'later' | 'someday';

const dayAt = (base: Date, addDays: number, hour: number) => {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + addDays, hour);
  return d.getTime();
};
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

/** Tonight 18:00 (before 17:00), tomorrow 9:00, Saturday 10:00 (on weekdays), next Monday 9:00, in a week 9:00. */
export function dueChoices(now: Date): { key: DueKey; at: number }[] {
  const wd = now.getDay(); // 0 = Sunday
  const out: { key: DueKey; at: number }[] = [];
  if (now.getHours() < 17) out.push({ key: 'tonight', at: dayAt(now, 0, 18) });
  out.push({ key: 'tomorrow', at: dayAt(now, 1, 9) });
  if (wd >= 1 && wd <= 4) out.push({ key: 'weekend', at: dayAt(now, 6 - wd, 10) });
  const monday = dayAt(now, ((8 - wd) % 7) || 7, 9);
  if (!out.some((c) => sameDay(c.at, monday))) out.push({ key: 'nextWeek', at: monday });
  out.push({ key: 'inWeek', at: dayAt(now, 7, 9) });
  return out;
}

export function dueGroup(due: number | null, now: Date): DueGroup {
  if (due === null) return 'someday';
  if (due < now.getTime()) return 'late';
  if (sameDay(due, now.getTime())) return 'today';
  return due < dayAt(now, 7, 0) ? 'soon' : 'later';
}
