import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, addMonths, withinMonths } from './dates.js';

test('parseDate handles common formats and rejects garbage', () => {
  assert.equal(parseDate('2026-06-28'), '2026-06-28');
  assert.equal(parseDate('2026/06/28'), '2026-06-28');
  assert.equal(parseDate('28 Jun 2026'), '2026-06-28');
  assert.equal(parseDate('June 28, 2026'), '2026-06-28');
  assert.equal(parseDate('2026-02-30'), null);
  assert.equal(parseDate('garbage'), null);
});

test('addMonths clamps to month end', () => {
  assert.equal(addMonths('2026-11-15', -12), '2025-11-15');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
});

test('withinMonths is a window ending at the reference date', () => {
  assert.equal(withinMonths('2025-12-02', '2026-11-15', 12), true);
  assert.equal(withinMonths('2025-10-30', '2026-11-15', 12), false);
  assert.equal(withinMonths('2026-11-15', '2026-11-15', 12), true);
  assert.equal(withinMonths('2026-12-01', '2026-11-15', 12), false);
});
