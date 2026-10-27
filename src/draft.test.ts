import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addMonths, cite, parseDate, sentences, withinMonths } from './helpers.js';
import { draftForm } from './draft.js';
import type { Doc } from './helpers.js';
import { chartA, chartB, demoA, demoB, doc, form, run } from './testkit.js';

const A = (id: string) => run(id, chartA, demoA);

describe('text and dates', () => {
  const d = doc('X1', '2026-06-30', 'Collected 2026-06-28. Eosinophils 0.45 x10^9/L. Dr. Lee agrees.');

  test('sentences are exact slices and do not split decimals or "Dr."', () => {
    assert.deepEqual(sentences(d), ['Collected 2026-06-28.', 'Eosinophils 0.45 x10^9/L.', 'Dr. Lee agrees.']);
  });
  test('cite refuses a quote that is not verbatim', () => {
    assert.deepEqual(cite(d, 'Collected 2026-06-28.'), { doc_id: 'X1', quote: 'Collected 2026-06-28.' });
    assert.throws(() => cite(d, 'Collected 2026-06-29.'));
  });
  test('parseDate reads common formats, rejects impossible and ambiguous ones', () => {
    assert.equal(parseDate('28 Jun 2026'), '2026-06-28');
    assert.equal(parseDate('June 28, 2026'), '2026-06-28');
    assert.equal(parseDate('2026-02-30'), null);
    assert.equal(parseDate('08/09/2026'), null);
  });
  test('windows end at the reference date and clamp month ends', () => {
    assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
    assert.equal(withinMonths('2025-12-02', '2026-11-15', 12), true);
    assert.equal(withinMonths('2025-11-15', '2026-11-15', 12), false);
    assert.equal(withinMonths('2026-12-01', '2026-11-15', 12), false);
  });
});

describe('chart A end to end', () => {
  const fields = draftForm(form, chartA, demoA);

  test('one entry per form field, in order, with the expected statuses', () => {
    assert.deepEqual(fields.map((f) => f.field_id), form.fields.map((f) => f.field_id));
    assert.deepEqual(fields.map((f) => f.status), [
      'DRAFTED', 'DRAFTED', 'DRAFTED', 'DRAFTED', 'DRAFTED', 'DRAFTED',
      'NOT_DOCUMENTED', 'NOT_DOCUMENTED', 'DRAFTED', 'NOT_DOCUMENTED', 'NEEDS_PHYSICIAN', 'NEEDS_PHYSICIAN',
    ]);
  });
  test('every quote, including computation inputs, is verbatim in its document', () => {
    const text = new Map(chartA.map((d) => [d.doc_id, d.text]));
    text.set('demographics', Object.entries(demoA).map(([k, v]) => `${k}: ${v}`).join('\n'));
    for (const f of fields) {
      for (const c of [...f.citations, ...(f.computation?.inputs ?? [])]) assert.ok(text.get(c.doc_id)?.includes(c.quote), `${f.field_id}: ${c.quote}`);
    }
  });
  test('the trap value is right: lab by collection date, not the reprint', () => {
    assert.equal(A('blood_eosinophils_most_recent').value, '0.45 x10^9/L (collected 2026-06-28)');
  });
});

/**
 * Chart B was written after the code, with its expected answers fixed first, in different wording from
 * chart A ("mom", brand names, "Collection date:", a dose pack described in two notes).
 */
describe('chart B (written independently of the code)', () => {
  const B = (id: string) => run(id, chartB, demoB);
  const quotes = (f: ReturnType<typeof B>) => f.citations.map((c) => c.quote).join(' ');

  test('demographics come from the record, not the wrong PHN in a note', () => {
    assert.equal(B('phn').value, 'SYNTH-PHN-0777');
    assert.equal(B('patient_name').value, 'Okafor, Dana');
  });
  test('diagnosis: the newest specialist statement, ignoring a future-dated "resolved" note', () => {
    const r = B('diagnosis');
    assert.match(String(r.value), /severe persistent asthma/);
    assert.equal(r.citations[0].doc_id, 'B02');
  });
  test('a pulmonologist note inside 24 months confirms the diagnosis', () => {
    assert.equal(B('respirologist_confirmed_within_24_months').value, true);
  });
  test('eosinophils: the newest collection date, not the reprinted older result', () => {
    assert.equal(B('blood_eosinophils_most_recent').value, '0.38 x10^9/L (collected 2026-09-12)');
  });
  test('biologic: tezepelumab with both dates and outcome; the discussed dupilumab is left out', () => {
    const r = B('prior_biologic_trial');
    assert.equal(r.status, 'DRAFTED');
    assert.match(String(r.value), /Tezepelumab[^]*2025-03-04[^]*2025-10-20/);
    assert.doesNotMatch(quotes(r), /Dupilumab/);
  });
  test('opinion and physician-entered fields stay with the physician', () => {
    assert.equal(B('inadequate_control_despite_high_dose_ics').status, 'NEEDS_PHYSICIAN');
    assert.equal(B('requested_dose_regimen').status, 'NEEDS_PHYSICIAN');
  });
});

describe('demographic and physician-only fields', () => {
  test('filled from demographics.json only, even when a note says otherwise', () => {
    const r = run('phn', [doc('N1', '2026-01-01', 'PHN SYNTH-PHN-9999.')], { phn: 'SYNTH-PHN-0001' });
    assert.equal(r.value, 'SYNTH-PHN-0001');
    assert.deepEqual(r.citations, [{ doc_id: 'demographics', quote: 'phn: SYNTH-PHN-0001' }]);
  });
  test('a value missing from demographics.json is NOT_DOCUMENTED, not read from a note', () => {
    assert.equal(run('phn', [doc('N1', '2026-01-01', 'PHN SYNTH-PHN-9999.')]).status, 'NOT_DOCUMENTED');
  });
  test('opinion and physician-entered fields are never filled; hints are verbatim', () => {
    const r = A('inadequate_control_despite_high_dose_ics');
    assert.equal(r.status, 'NEEDS_PHYSICIAN');
    assert.equal(r.value, null);
    assert.ok(r.citations.length > 0);
    assert.equal(A('requested_dose_regimen').status, 'NEEDS_PHYSICIAN');
  });
});

describe('factual fields: the newest document governs, and doubt means blank', () => {
  test('diagnosis: newest statement wins; hedged or withdrawn is not a diagnosis', () => {
    const base = doc('D1', '2025-01-10', 'Impression: moderate asthma.');
    assert.equal(run('diagnosis', [base]).value, 'moderate asthma');
    assert.equal(run('diagnosis', [base, doc('D2', '2026-03-01', 'Impression: asthma ruled out.')]).status, 'NOT_DOCUMENTED');
    assert.equal(run('diagnosis', [base, doc('D2', '2026-03-01', 'Assessment: ?asthma.')]).status, 'NOT_DOCUMENTED');
  });
  test('prior biologic: needs dates; plans, refusals and relatives do not count', () => {
    const done = doc('B1', '2025-02-01', 'Mepolizumab started 2024-01-10 and stopped 2024-09-10 for no response.');
    assert.equal(run('prior_biologic_trial', [done]).status, 'DRAFTED');
    for (const text of ['Plan: trial of omalizumab.', 'Patient declined mepolizumab.', 'Her sister received omalizumab, started 2024-01-10, stopped 2024-09-10.', 'Mepolizumab was stopped.']) {
      assert.equal(run('prior_biologic_trial', [doc('B2', '2025-02-01', text)]).status, 'NOT_DOCUMENTED', text);
    }
  });
  test('prior biologic: two different start dates are left blank', () => {
    const a = doc('B1', '2025-01-01', 'Mepolizumab started 2024-01-10.');
    const b = doc('B2', '2025-03-01', 'Mepolizumab started 2024-02-20.');
    const stop = doc('B3', '2025-04-01', 'Mepolizumab stopped 2024-09-10.');
    assert.equal(run('prior_biologic_trial', [a, stop]).status, 'DRAFTED');
    assert.equal(run('prior_biologic_trial', [a, b, stop]).status, 'NOT_DOCUMENTED');
  });
});

describe('verbatim dated lab', () => {
  const lab = (id: string, date: string, text: string) => doc(id, date, text, 'laboratory', 'lab_report');
  const eos = (...docs: Doc[]) => run('blood_eosinophils_most_recent', docs);

  test('uses the collection date, and the newest collection beats the newest report', () => {
    const r = eos(lab('L1', '2026-06-30', 'Collected 2026-06-28. Eosinophils 0.45 x10^9/L.'), lab('L2', '2026-07-05', 'Reprinted. Collected 2025-11-10. Eosinophils 0.62 x10^9/L.'));
    assert.equal(r.value, '0.45 x10^9/L (collected 2026-06-28)');
  });
  test('never falls back to the report date; percentages and future reports are not used', () => {
    assert.equal(eos(lab('L1', '2026-06-30', 'Eosinophils 0.45 x10^9/L.')).status, 'NOT_DOCUMENTED');
    assert.equal(eos(lab('L1', '2026-06-30', 'Collected 2026-06-28. Eosinophils 4 %.')).status, 'NOT_DOCUMENTED');
    assert.equal(eos(lab('L1', '2027-01-30', 'Collected 2027-01-28. Eosinophils 0.45 x10^9/L.')).status, 'NOT_DOCUMENTED');
  });
});

describe('fields left blank on purpose', () => {
  test('inhaler and smoking are never drafted, even when the chart states them plainly', () => {
    const docs = [doc('C1', '2026-01-05', 'Current meds: fluticasone 250 mcg twice daily. Never smoker.')];
    for (const id of ['current_inhaled_therapy', 'smoking_status']) assert.equal(run(id, docs).status, 'NOT_DOCUMENTED');
  });
});

describe('steroid courses', () => {
  test('are never drafted, even when the chart states a clear course', () => {
    const r = run('systemic_steroid_courses_past_12_months', [doc('C1', '2026-01-05', 'Asthma exacerbation. Prednisone 40 mg daily for 5 days.')]);
    assert.equal(r.status, 'NOT_DOCUMENTED');
    assert.equal(r.value, null);
  });
});

describe('respirologist confirmation', () => {
  const resp = (id: string, date: string, text: string) => doc(id, date, text, 'respirologist', 'consult_letter');
  const confirmed = (...docs: Doc[]) => run('respirologist_confirmed_within_24_months', docs);

  test('true when a respirologist states the diagnosis inside 24 months, citing that note', () => {
    const r = confirmed(resp('R1', '2025-03-01', 'Impression: severe asthma.'));
    assert.equal(r.value, true);
    assert.equal(r.citations[0].doc_id, 'R1');
  });
  test('never false: an older confirmation, a non-respirologist, or silence is blank', () => {
    assert.equal(confirmed(resp('R1', '2023-03-01', 'Impression: severe asthma.')).status, 'NOT_DOCUMENTED');
    assert.equal(confirmed(doc('R1', '2025-03-01', 'Impression: severe asthma.')).status, 'NOT_DOCUMENTED');
    assert.equal(confirmed().status, 'NOT_DOCUMENTED');
  });
  test('a newer respirologist note that withdraws the diagnosis ends the search', () => {
    assert.equal(confirmed(resp('R1', '2025-03-01', 'Impression: severe asthma.'), resp('R2', '2026-03-01', 'Impression: asthma excluded.')).status, 'NOT_DOCUMENTED');
  });
});

describe('form-level behaviour', () => {
  test('documents dated after the form date or with unreadable dates never govern', () => {
    assert.equal(run('diagnosis', [doc('D1', '2027-01-01', 'Impression: severe asthma.')]).status, 'NOT_DOCUMENTED');
    assert.equal(run('diagnosis', [doc('D1', 'last spring', 'Impression: severe asthma.')]).status, 'NOT_DOCUMENTED');
  });
  test('an unknown class or field id abstains instead of crashing', () => {
    const fields = [
      { field_id: 'constructor', label: '', class: 'FACTUAL_CITED', answer_type: 'text' },
      { field_id: 'x', label: '', class: 'MYSTERY', answer_type: 'text' },
    ];
    assert.deepEqual(draftForm({ ...form, fields }, chartA, demoA).map((f) => f.status), ['NOT_DOCUMENTED', 'NOT_DOCUMENTED']);
  });
});

describe('command line', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'draft-'));
  const out = join(tmp, 'nested', 'out.json');

  test('writes the documented output shape', () => {
    execFileSync('node', ['dist/draft.js', '--chart', 'chart-A', '--form', 'form/F-DEMO-01.json', '--out', out]);
    const result = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(result.chart, 'chart-A');
    assert.equal(result.form_id, 'F-DEMO-01');
    assert.deepEqual(Object.keys(result.fields[0]), ['field_id', 'status', 'value', 'citations', 'computation']);
  });
  test('a missing argument or file gives a one-line error and a non-zero exit', () => {
    for (const args of [['--chart', 'chart-A'], ['--chart', 'nope', '--form', 'form/F-DEMO-01.json', '--out', out]]) {
      const r = spawnSync('node', ['dist/draft.js', ...args], { encoding: 'utf8' });
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /^error: /);
    }
  });
  test('cleanup', () => rmSync(tmp, { recursive: true, force: true }));
});

describe('traps found by review: each must abstain or give the right value', () => {
  // [field, [date, text, role?][], expected value, or null to require NOT_DOCUMENTED]
  const cases: [string, [string, string, string?][], string | number | null][] = [
    ['blood_eosinophils_most_recent', [['2026-06-30', 'Specimen received 2026-07-02, collected 2026-06-28. Eosinophils 0.45 x10^9/L.']], '0.45 x10^9/L (collected 2026-06-28)'],
    ['blood_eosinophils_most_recent', [['2026-09-05', 'Eosinophils 0.80 x10^9/L collected 2026-03-01. Eosinophils 0.20 x10^9/L collected 2026-09-01.']], '0.20 x10^9/L (collected 2026-09-01)'],
    ['blood_eosinophils_most_recent', [['2026-09-01', 'Sputum induction collected 2026-09-01. Sputum eosinophils 12 cells/mm3.']], null],
    ['diagnosis', [['2026-05-05', 'Dx: Asthma not currently active.']], null],
    ['diagnosis', [['2026-05-05', 'Assessment: asthma action plan updated; diagnosis under review.']], null],
    ['diagnosis', [['2025-10-01', 'Impression: severe eosinophilic asthma.'], ['2026-09-10', 'Reassessed: the asthma diagnosis was incorrect; this is vocal cord dysfunction.']], null],
    ['diagnosis', [['2026-05-05', 'Assessment: asthma, though diagnosis has not been confirmed by testing.']], null],
    ['diagnosis', [['2026-09-10', 'Assessment: stepfather has severe persistent asthma.']], null],
    ['diagnosis', [['2026-09-10', 'Assessment: 1. Moderate persistent asthma. 2. GERD.']], 'Moderate persistent asthma'],
    ['prior_biologic_trial', [['2025-09-01', 'Mepolizumab started 2024-01-10 and stopped 2024-06-10.'], ['2026-09-01', 'Restarted mepolizumab 2026-03-01 after a gap.']], null],
    ['prior_biologic_trial', [['2026-09-01', 'Dupilumab started 2025-01-10 (elsewhere 2025-02-10) and stopped 2025-08-01.', 'respirologist']], null],
    ['prior_biologic_trial', [['2026-05-01', 'Omalizumab started 2024-05-15 and stopped 2024-09-10.'], ['2026-09-01', 'Omalizumab was stopped 2024-10-02.']], null],
    ['respirologist_confirmed_within_24_months', [['2026-03-10', 'Diagnosis: severe asthma.', 'respirology_clinic_nurse']], null],
    ['respirologist_confirmed_within_24_months', [['2026-03-10T09:30:00', 'Impression: severe asthma.', 'respirologist']], 'true'],
  ];
  for (const [field, docs, want] of cases) {
    test(`${field}: ${docs.map((d) => d[1]).join(' / ').slice(0, 70)}`, () => {
      const r = run(field, docs.map(([date, text, role], i) => doc(`T${i}`, date, text, role)));
      if (want === null) assert.equal(r.status, 'NOT_DOCUMENTED');
      else assert.equal(String(r.value), String(want));
    });
  }
});

describe('chart C (small, written separately: different wording, expected answers set first)', () => {
  const docs = [
    doc('C01', '2024-03-10', 'Dx: asthma, mild intermittent.'),
    doc('C02', '2025-02-14', 'Pulmonology clinic. Assessment: moderate persistent asthma, uncontrolled.', 'pulmonologist'),
    doc('C03', '2025-06-02', 'Dupilumab: start date 2024-09-01; stop date 2025-05-20; outcome: no benefit.', 'pulmonologist'),
    doc('C04', '2026-03-09', 'CBC. Report printed 2026-03-12; sample collected 2026-03-08. Eosinophils 0.62 x10^9/L.'),
    doc('C05', '2026-09-30', 'Reprint of an old CBC. Eosinophils 0.15 x10^9/L. Collected 2026-01-04.'),
  ];
  const C = (id: string) => run(id, docs, { patient_name: 'Chart, Cee', phn: 'SYNTH-PHN-0003', date_of_birth: '1990-01-01' });

  test('diagnosis: the newest statement, with its qualifiers', () => {
    assert.equal(C('diagnosis').value, 'moderate persistent asthma');
  });
  test('respirologist: a pulmonologist note inside 24 months counts', () => {
    assert.equal(C('respirologist_confirmed_within_24_months').value, true);
  });
  test('eosinophils: the collection date, not the print date or the later reprint', () => {
    assert.equal(C('blood_eosinophils_most_recent').value, '0.62 x10^9/L (collected 2026-03-08)');
  });
  test('biologic: both dates and the outcome from one record', () => {
    assert.match(String(C('prior_biologic_trial').value), /2024-09-01[^]*2025-05-20[^]*no benefit/);
  });
  test('the fields left blank on purpose stay blank', () => {
    for (const id of ['systemic_steroid_courses_past_12_months', 'current_inhaled_therapy', 'smoking_status']) {
      assert.equal(C(id).status, 'NOT_DOCUMENTED');
    }
  });
});
