import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftDemographic, draftPhysicianOnly } from './demographic.js';
import { demoA, chartA, field } from './testdata.js';

test('phn is drafted from demographics with a field: value quote', () => {
  const r = draftDemographic(field('phn', 'DEMOGRAPHIC'), demoA);
  assert.equal(r.status, 'DRAFTED');
  assert.equal(r.value, 'SYNTH-PHN-0001');
  assert.deepEqual(r.citations, [{ doc_id: 'demographics', quote: 'phn: SYNTH-PHN-0001' }]);
});

test('a stale PHN in a note never overrides demographics', () => {
  assert.ok(chartA.some((d) => d.text.includes('SYNTH-PHN-0009')));
  assert.equal(draftDemographic(field('phn', 'DEMOGRAPHIC'), demoA).value, 'SYNTH-PHN-0001');
});

test('a missing or blank demographics value is NOT_DOCUMENTED', () => {
  const r = draftDemographic(field('date_of_birth', 'DEMOGRAPHIC'), { patient_name: 'X, Y' });
  assert.equal(r.status, 'NOT_DOCUMENTED');
  assert.equal(r.value, null);
  assert.equal(draftDemographic(field('phn', 'DEMOGRAPHIC'), { phn: '  ' }).status, 'NOT_DOCUMENTED');
});

test('physician-only fields never draft a value', () => {
  for (const cls of ['OPINION_PHYSICIAN', 'PHYSICIAN_ENTERED']) {
    const r = draftPhysicianOnly(field('inadequate_control_despite_high_dose_ics', cls), chartA);
    assert.equal(r.status, 'NEEDS_PHYSICIAN');
    assert.equal(r.value, null);
  }
});

test('helpful citations on opinion fields are verbatim', () => {
  const r = draftPhysicianOnly(field('inadequate_control_despite_high_dose_ics', 'OPINION_PHYSICIAN'), chartA);
  for (const c of r.citations) {
    assert.ok(chartA.find((d) => d.doc_id === c.doc_id)!.text.includes(c.quote));
  }
});
