import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isoWeek } from '../src/dates.ts';

const at = (s: string) => new Date(`${s}T12:00:00`);

test('ISO week of an ordinary day', () => {
  assert.equal(isoWeek(at('2026-11-12')), 46);
  assert.equal(isoWeek(at('2026-11-09')), 46); // Monday
  assert.equal(isoWeek(at('2026-11-15')), 46); // Sunday
});

test('the first days of January can belong to the last week of the year before', () => {
  assert.equal(isoWeek(at('2027-01-01')), 53); // Friday: 2026 has 53 weeks
  assert.equal(isoWeek(at('2027-01-03')), 53);
  assert.equal(isoWeek(at('2027-01-04')), 1);
});

test('the last days of December can belong to week 1 of the year after', () => {
  assert.equal(isoWeek(at('2025-12-29')), 1);
  assert.equal(isoWeek(at('2025-12-28')), 52);
});
