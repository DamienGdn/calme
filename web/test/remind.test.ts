import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dueChoices, dueGroup } from '../src/remind.ts';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const keys = (now: Date) => dueChoices(now).map((c) => [c.key, c.at]);

test('on a Thursday morning: tonight, tomorrow, the weekend, next week, in a week', () => {
  assert.deepEqual(keys(new Date(2026, 10, 12, 10)), [
    ['tonight', at(12, 18)],
    ['tomorrow', at(13, 9)],
    ['weekend', at(14, 10)],
    ['nextWeek', at(16, 9)],
    ['inWeek', at(19, 9)],
  ]);
});

test('late in the evening there is no "tonight"', () => {
  assert.equal(keys(new Date(2026, 10, 12, 20)).some(([k]) => k === 'tonight'), false);
});

test('on a Sunday: no weekend, and next week is not repeated when it is tomorrow', () => {
  assert.deepEqual(keys(new Date(2026, 10, 15, 10)).map(([k]) => k), ['tonight', 'tomorrow', 'inWeek']);
});

test('reminders are grouped: late, today, this week, later, someday', () => {
  const now = new Date(2026, 10, 12, 10);
  assert.equal(dueGroup(at(12, 9), now), 'late');
  assert.equal(dueGroup(at(12, 18), now), 'today');
  assert.equal(dueGroup(at(16, 9), now), 'soon');
  assert.equal(dueGroup(at(30, 9), now), 'later');
  assert.equal(dueGroup(null, now), 'someday');
});
