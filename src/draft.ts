/**
 * Cited form drafter: fills a form from a patient chart, offline, with verbatim citations.
 *
 * Flow: CLI (`main`) -> `draftForm` -> one drafter per field -> `guard` re-checks every quote -> JSON file.
 *
 * Rules every drafter follows:
 *   1. Quotes are slices of the source text, never paraphrases (`cite` enforces it).
 *   2. If the chart does not support a value, return NOT_DOCUMENTED. Absence is never 0/false/"none".
 *   3. When unsure, abstain: a blank costs the physician seconds, a wrong value costs far more.
 *   4. Only documents dated on or before the form date may govern a field: a later note could not
 *      have been known when the form was filled.
 *
 * Where things live: helpers.ts (types, quoting, dates, shared vocabularies), facts.ts (diagnosis, biologic),
 * measures.ts (lab, respirologist; the steroid count is deliberately left blank). This file holds the
 * demographic fields, the guard that re-checks every quote, the dispatch and the CLI.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { Citation, Doc, Drafter, FieldDraft, Form, FormField, cite, drafted, eligible, needsPhysician, notDocumented, parseDate,
  sentenceContaining, stripSemicolon } from './helpers.js';
import { diagnosis, priorBiologic } from './facts.js';
import { draftLab, respirologistConfirmed, steroidCourses } from './measures.js';

// -- Demographic and physician-only fields --

/**
 * Identifiers come from demographics.json only. Notes copy them from old forms and other patients
 * (chart A has a wrong PHN in a note), so a note is never trusted for them.
 */
export function draftDemographic(f: FormField, demo: Record<string, unknown>): FieldDraft {
  const v = demo[f.field_id];
  if (typeof v !== 'string' || !v.trim()) return notDocumented(f);
  return drafted(f, v, [{ doc_id: 'demographics', quote: `${f.field_id}: ${v}` }]);
}

/** Wording that lets a physician judge control at a glance. Shown as a hint; it never decides the field. */
const HELPFUL = /\b(symptomatic|poorly controlled|inadequately controlled|uncontrolled|high-dose inhaled corticosteroid)\b/i;

/** Opinion and physician-entered fields are never filled; opinion fields get supporting quotes as hints. */
export function draftPhysicianOnly(f: FormField, docs: Doc[]): FieldDraft {
  if (f.class !== 'OPINION_PHYSICIAN') return needsPhysician(f);
  const citations: Citation[] = [];
  for (const d of docs) {
    const s = sentenceContaining(d, HELPFUL);
    if (s) citations.push(cite(d, stripSemicolon(s)));
  }
  return needsPhysician(f, citations);
}

// -- Grounding guard --

/** The text each doc_id may be quoted from. Demographics are quoted as "field: value" lines, as the brief specifies. */
function quotableText(docs: Doc[], demo: Record<string, unknown>): Map<string, string> {
  // Two documents sharing an id are both quotable under it.
  const m = new Map<string, string>();
  for (const d of docs) m.set(d.doc_id, `${m.get(d.doc_id) ?? ''}\0${d.text}`);
  m.set('demographics', Object.entries(demo).filter(([k]) => k !== 'doc_id').map(([k, v]) => `${k}: ${v}`).join('\n'));
  return m;
}

function isVerbatim(c: Citation, texts: Map<string, string>): boolean {
  const t = texts.get(c?.doc_id);
  return typeof t === 'string' && typeof c.quote === 'string' && c.quote.trim() !== '' && t.includes(c.quote);
}

/**
 * Last line of defence, independent of the drafters: a DRAFTED field survives only with a value,
 * a citation, and every quote (computation inputs included) found verbatim in its document;
 * otherwise it is downgraded to NOT_DOCUMENTED. A NEEDS_PHYSICIAN field keeps only verbatim hints.
 *
 * It proves a quote exists, not that it supports the value. Picking the right sentence (negation,
 * hedging, other people, dates) is the drafters' job.
 */
export function guard(f: FormField, d: FieldDraft, docs: Doc[], demo: Record<string, unknown>): FieldDraft {
  const texts = quotableText(docs, demo);
  const inputs = d.computation?.inputs ?? [];
  if (d.status === 'DRAFTED') {
    const grounded = d.value !== null && d.value !== undefined && d.citations.length > 0 &&
      d.citations.every((c) => isVerbatim(c, texts)) && inputs.every((c) => isVerbatim(c, texts));
    return grounded ? d : notDocumented(f);
  }
  if (d.status === 'NEEDS_PHYSICIAN') {
    return { ...d, value: null, citations: d.citations.filter((c) => isVerbatim(c, texts)), computation: null };
  }
  return notDocumented(f);
}

/** Drafters for fields filled from note text, by field id. A Map, so an id like "constructor" cannot hit an object prototype. */
const NOTE_DRAFTERS = new Map<string, Drafter>([
  ['diagnosis', diagnosis],
  ['respirologist_confirmed_within_24_months', respirologistConfirmed],
  ['blood_eosinophils_most_recent', draftLab],
  ['systemic_steroid_courses_past_12_months', steroidCourses],
  ['prior_biologic_trial', priorBiologic],
]);

/** The class decides how much trust a field gets: fixed rules for the first three cases, a per-field drafter for the rest. */
function draftField(f: FormField, demo: Record<string, unknown>, docs: Doc[], formDate: string): FieldDraft {
  switch (f.class) {
    case 'DEMOGRAPHIC': return draftDemographic(f, demo);
    case 'OPINION_PHYSICIAN':
    case 'PHYSICIAN_ENTERED': return draftPhysicianOnly(f, docs);
    case 'FACTUAL_CITED':
    case 'VERBATIM_DATED':
    case 'COMPUTED_CITED':
    case 'SENSITIVE_EXPLICIT_ONLY': return (NOTE_DRAFTERS.get(f.field_id) ?? (() => notDocumented(f)))(f, docs, formDate);
    default: return notDocumented(f);  // a class we have no rule for is never guessed at
  }
}

/**
 * Drafts every field of the form, in form order. A drafter that throws, or returns an ungrounded
 * value, yields NOT_DOCUMENTED for that field only; the rest of the form is unaffected.
 */
export function draftForm(form: Form, allDocs: Doc[], demo: Record<string, unknown>): FieldDraft[] {
  const rawDocs = allDocs.filter((d) => d && typeof d.doc_id === 'string' && typeof d.text === 'string');
  const formDate = parseDate(form.form_date) ?? form.form_date;
  // Dates are compared as ISO strings, so normalise them first. A document whose date we cannot read
  // is dropped: we could not tell whether it is newer than the one that should govern.
  const dated = rawDocs.filter((d) => typeof d.date === 'string').map((d) => ({ ...d, date: parseDate(d.date) ?? '' })).filter((d) => d.date !== '');
  const docs = eligible(dated, formDate);
  return form.fields.map((f) => {
    let draft: FieldDraft;
    // A bug in one drafter must cost one blank field, not the whole form.
    try {
      draft = draftField(f, demo, docs, formDate);
    } catch {
      draft = notDocumented(f);
    }
    // Check against rawDocs, the text exactly as loaded, not the date-normalised copies the drafters read.
    return guard(f, draft, rawDocs, demo);
  });
}

// -- CLI --

const USAGE = 'usage: npm run draft -- --chart <chart dir> --form <form.json> --out <output.json>';

/** Rejects `--chart --form x` (a flag where a value belongs) instead of reading "--form" as the chart path. */
function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i < 0 ? undefined : process.argv[i + 1];
  if (!value || value.startsWith('--')) throw new Error(`missing --${name}\n${USAGE}`);
  return value;
}

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (e) {
    throw new Error(`cannot read ${path}: ${(e as Error).message}`);
  }
}

function main(): void {
  try {
    const chartDir = arg('chart');
    const form = readJson<Form>(arg('form'));
    const docs = readJson<Doc[]>(join(chartDir, 'documents.json'));
    const demographics = readJson<Record<string, unknown>>(join(chartDir, 'demographics.json'));
    if (!Array.isArray(form.fields) || !Array.isArray(docs)) throw new Error('form needs a "fields" array and documents.json must be an array');

    const fields = draftForm(form, docs, demographics);

    const out = arg('out');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ chart: basename(resolve(chartDir)), form_id: form.form_id, fields }, null, 2));
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

// Run only as the program, not when the tests import this file.
if (process.argv[1]?.endsWith('draft.js')) main();
