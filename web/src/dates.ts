/** ISO 8601 week number (weeks start on Monday; week 1 holds the year's first Thursday), as used in France. */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day); // the Thursday of this week decides the year
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

/** An older mail's date: short weekday, day and month ("mer. 4 nov."), and the year when it is not the current one. */
export function farDate(ts: number, now: Date, locale: string): string {
  const d = new Date(ts);
  const year = d.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {};
  return d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', ...year }).replace(/,/g, '');
}
