import { describe, expect, it } from 'vitest';
import { openReminders } from '../src/reminders.ts';
import { openStore } from '../src/store.ts';

const fresh = () => openReminders(openStore(':memory:').db);

describe('reminders', () => {
  it('keeps a reminder from a mail, open ones first by date, undated last', () => {
    const r = fresh();
    const a = r.add({ text: 'Compteur de chantier', due: 3000, mail: { id: 'm1', subject: 'Maison', fromName: 'Archi' } }, 100);
    r.add({ text: 'Sans date', due: null }, 200);
    r.add({ text: 'Avant', due: 2000 }, 300);
    r.update(r.add({ text: 'Fait', due: 1000 }, 400).id, { done: true }, 500);
    expect(r.list().map((x) => x.text)).toEqual(['Avant', 'Compteur de chantier', 'Sans date', 'Fait']);
    expect(r.get(a.id)).toMatchObject({ mailId: 'm1', mailSubject: 'Maison', mailFrom: 'Archi', done: false, createdAt: 100 });
  });

  it('edits, completes and deletes', () => {
    const r = fresh();
    const { id } = r.add({ text: 'x', due: null }, 1);
    expect(r.update(id, { text: 'y', due: 50 }, 2)).toMatchObject({ text: 'y', due: 50 });
    expect(r.update(id, { done: true }, 3)).toMatchObject({ done: true, doneAt: 3 });
    expect(r.update('nope', { done: true }, 3)).toBeNull();
    expect(r.remove(id)).toBe(true);
    expect(r.list()).toEqual([]);
  });

  it('warns ahead when asked (a day or an hour before), then at the time', () => {
    const r = fresh();
    const a = r.add({ text: 'Compteur', due: 100_000_000, early: 1440 }, 1);
    expect(r.soon(100_000_000 - 1440 * 60_000 - 1)).toEqual([]);
    expect(r.soon(100_000_000 - 1440 * 60_000).map((x) => x.id)).toEqual([a.id]);
    r.markNotified([a.id], 'early');
    expect(r.soon(100_000_000 - 1000)).toEqual([]);
    expect(r.due(100_000_000).map((x) => x.id)).toEqual([a.id]);
    expect(r.add({ text: 'x', due: 5 }, 1).early).toBe(0);
  });

  it('hands each due reminder to the notification once, and again after its date changes', () => {
    const r = fresh();
    const a = r.add({ text: 'due', due: 1000 }, 1);
    r.add({ text: 'later', due: 9000 }, 1);
    r.add({ text: 'no date', due: null }, 1);
    expect(r.due(5000).map((x) => x.text)).toEqual(['due']);
    r.markNotified([a.id]);
    expect(r.due(5000)).toEqual([]);
    r.update(a.id, { due: 6000 }, 2);
    expect(r.due(7000).map((x) => x.text)).toEqual(['due']);
  });
});
