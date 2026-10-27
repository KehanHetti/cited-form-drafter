/** Shared by every drafter: output types, verbatim quoting, sentence splitting, dates, and common vocabularies. */

// -- Types --
// The JSON shape is fixed by the brief. Giving each status its own type lets the compiler prove, for
// example, that a DRAFTED field always carries a value and a citation.

export type Status = 'DRAFTED' | 'NEEDS_PHYSICIAN' | 'NOT_DOCUMENTED';
export interface Citation { doc_id: string; quote: string }
export interface Computation { rule: string; inputs: Citation[] }

/** Filled by the program: always has a value and at least one verbatim citation. */
export interface DraftedField {
  field_id: string;
  status: 'DRAFTED';
  value: string | number | boolean;
  citations: Citation[];
  computation: Computation | null;
}
/** Left for the physician: never has a value; citations are optional hints. */
interface NeedsPhysicianField {
  field_id: string;
  status: 'NEEDS_PHYSICIAN';
  value: null;
  citations: Citation[];
  computation: null;
}
/** Left blank because the chart does not support a value: no value, no citations. */
interface NotDocumentedField {
  field_id: string;
  status: 'NOT_DOCUMENTED';
  value: null;
  citations: never[];
  computation: null;
}
export type FieldDraft = DraftedField | NeedsPhysicianField | NotDocumentedField;

export interface Doc { doc_id: string; date: string; type: string; author_role: string; text: string }
export interface FormField { field_id: string; label: string; class: string; answer_type: string }
export interface Form { form_id: string; title: string; form_date: string; fields: FormField[] }

/** A drafter fills one field from already date-filtered documents (newest first). */
export type Drafter = (f: FormField, docs: Doc[], formDate: string) => FieldDraft;

// -- Result builders --

export function drafted(
  f: FormField, value: string | number | boolean, citations: Citation[], computation: Computation | null = null,
): DraftedField {
  return { field_id: f.field_id, status: 'DRAFTED', value, citations, computation };
}

export function notDocumented(f: FormField): NotDocumentedField {
  return { field_id: f.field_id, status: 'NOT_DOCUMENTED', value: null, citations: [], computation: null };
}

export function needsPhysician(f: FormField, citations: Citation[] = []): NeedsPhysicianField {
  return { field_id: f.field_id, status: 'NEEDS_PHYSICIAN', value: null, citations, computation: null };
}

// -- Verbatim quoting and sentence splitting --

/** An empty quote is rejected explicitly: it is a substring of every document. */
export function quoteInDoc(doc: Doc, quote: string): boolean {
  return quote.length > 0 && doc.text.includes(quote);
}

/**
 * Every citation is built here, so a drafter that slices the wrong text fails loudly instead of
 * emitting a paraphrase. `draftForm` turns the exception into NOT_DOCUMENTED for that field.
 */
export function cite(doc: Doc, quote: string): Citation {
  if (!quoteInDoc(doc, quote)) throw new Error(`quote not in ${doc.doc_id}: ${quote}`);
  return { doc_id: doc.doc_id, quote };
}

// Templated notes ("Problem: ...\nMedication: ...") have no full stops between fields, so a line
// that starts "Label:" has to end the previous sentence.
const LABEL_LINE = String.raw`\n(?=\s*[A-Za-z][A-Za-z /()-]{1,30}:)`;
/** Abbreviations whose full stop does not end a sentence. */
const ABBREVIATION = /(?:^|\W)(?:Mr|Mrs|Ms|Dr|Prof|St|vs|coll)\.$/i;
/** Fields that belong to the line before them: "Medication: X; Dose: Y; Frequency: Z", "Result: ... Units: ...". */
const CONTINUATION = new RegExp(
  String.raw`^\s*(?:${[
    'start date', 'stop date', 'end date', 'dose', 'frequency', 'freq', 'route', 'duration', 'strength', 'status',
    'units?', 'sig', 'directions?', 'result', 'reason(?: stopped)?', 'outcome', 'response',
  ].join('|')})\s*:`,
  'i',
);

/**
 * Splits a document into sentences. Each one is an exact slice of `doc.text` (only surrounding
 * whitespace is trimmed), so it can be cited as a quote with no rewriting.
 *
 * Boundaries are . ! ? ; followed by whitespace (so "0.45" and "Ms." stay whole), a line break
 * before a "Label:" line, and a " | " column separator. A continuation line such as "Dose: ..."
 * is rejoined to the record before it, so a medication stays one unit.
 *
 * `splitClauses = false` stops ";" splitting, for answers that span clauses
 * ("started 2024-07-01; discontinued 2025-01-15 for inadequate response").
 */
export function sentences(doc: Doc, splitClauses = true): string[] {
  const boundary = new RegExp(`${splitClauses ? '[.!?;]' : '[.!?]'}(?=\\s|$)|${LABEL_LINE}|\\s\\|\\s`, 'g');
  const spans: { start: number; end: number }[] = [];
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(doc.text))) {
    // A line break or " | " is only a separator, so it is dropped; terminal punctuation stays on its sentence.
    if (m[0] === '\n' || m[0] === ' | ') {
      spans.push({ start, end: m.index });
      start = m.index + m[0].length;
      continue;
    }
    // "Assessment: 1. Severe asthma. 2. GERD.": a list number does not end a sentence.
    if (m[0] === '.' && /^\s*(?:[A-Za-z ]{1,20}:\s*)?\d{1,2}\.$/.test(doc.text.slice(start, m.index + 1))) continue;
    // Look back far enough to see the whole abbreviation ("Prof.") that this full stop belongs to.
    if (m[0] === '.' && ABBREVIATION.test(doc.text.slice(Math.max(0, m.index - 5), m.index + 1))) continue;
    spans.push({ start, end: m.index + 1 });
    start = m.index + 1;
  }
  spans.push({ start, end: doc.text.length });
  // Rejoin "Dose:"-style lines to their record: "Medication: X" alone is not a complete statement.
  const merged: { start: number; end: number }[] = [];
  for (const sp of spans.filter((x) => doc.text.slice(x.start, x.end).trim() !== '')) {
    const prev = merged[merged.length - 1];
    if (prev && CONTINUATION.test(doc.text.slice(sp.start, sp.end))) prev.end = sp.end;
    else merged.push({ ...sp });
  }
  return merged.map((x) => doc.text.slice(x.start, x.end).trim());
}

/** The first sentence matching `pattern`, or null. */
export function sentenceContaining(doc: Doc, pattern: RegExp): string | null {
  return sentences(doc).find((s) => pattern.test(s)) ?? null;
}

/** Drops the trailing ";" that our sentence splitter leaves on clause-final sentences. */
export const stripSemicolon = (s: string) => s.replace(/;$/, '');

// -- Dates --
// Every date is an ISO "YYYY-MM-DD" string, so `<` and `<=` order them chronologically with no Date objects.

export const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Date.UTC silently rolls 2026-02-30 over to 2 March, so round-trip the parts and reject any change.
function toIso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Parses "2026-06-28", "2026/6/28", "28 Jun 2026" and "June 28, 2026" to ISO; anything else is null. */
export function parseDate(s: string): string | null {
  const t = s.trim().replace(/[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/, '');
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t);
  if (m) return toIso(+m[1], +m[2], +m[3]);
  // A day above 12 reveals which number is the month. 08/09/2026 could be either order, so it is
  // rejected rather than guessed: a wrong date silently moves a course in or out of its window.
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    if (a > 12 && b <= 12) return toIso(+m[3], b, a);
    if (b > 12 && a <= 12) return toIso(+m[3], a, b);
    return null;
  }
  m = /^(\d{1,2})(?:\s+|-)([A-Za-z]{3,9})\.?,?(?:\s+|-)(\d{4})$/.exec(t);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return mi < 0 ? null : toIso(+m[3], mi + 1, +m[1]);
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t);
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return mi < 0 ? null : toIso(+m[3], mi + 1, +m[2]);
  }
  return null;
}

/** Adds (or subtracts) whole months, clamping to the month end (31 Mar - 1 month = 28 Feb). */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return toIso(ny, nm, Math.min(d, lastDay))!;
}

/**
 * The window is open at the start and closed at the end: a date exactly n months before `ref` is
 * outside it, while `ref` itself is inside. This is how "in the 12 months before the form date" reads.
 */
export function withinMonths(date: string, ref: string, n: number): boolean {
  return date > addMonths(ref, -n) && date <= ref;
}

/** "2023-03" or "March 2023": a month is enough for the biologic field, even though it cannot date a lab. */
const MONTH_ONLY = /\b\d{4}-\d{2}\b(?!-)|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\b/i;
export const hasDate = (s: string) => DATE_TOKEN.test(s) || MONTH_ONLY.test(s);

export const datesIn = (s: string) => (s.match(new RegExp(DATE_TOKEN.source, 'g')) ?? []).map(parseDate).filter((d): d is string => d !== null);

/** A date written as 2026-06-28, 28 Jun 2026, June 28, 2026 or 08/17/2026. */
export const DATE_TOKEN = new RegExp([
  String.raw`\d{4}[-/]\d{1,2}[-/]\d{1,2}`,                 // 2026-06-28
  String.raw`\d{1,2}\/\d{1,2}\/\d{4}`,                       // 08/17/2026
  String.raw`\d{1,2}-[A-Za-z]{3,9}-\d{4}`,                    // 28-Jun-2026
  String.raw`\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4}`,         // 28 Jun 2026
  String.raw`[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}`,         // June 28, 2026
].join('|'));

// -- Chart helpers and shared vocabularies --

/**
 * Documents dated on or before the form date, newest first. A later document could not have been
 * known when the form was filled. On a date tie the one listed later in the chart wins, on the
 * assumption that charts are appended to in time order.
 */
export function eligible(docs: Doc[], formDate: string): Doc[] {
  return docs
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.date <= formDate)
    .sort((a, b) => (a.d.date === b.d.date ? b.i - a.i : a.d.date < b.d.date ? 1 : -1))
    .map(({ d }) => d);
}

/** A case-insensitive regex matching any of `alternatives` as whole words. Entries are regex source, so `\w*` and `?` work. */
export const anyOf = (alternatives: string[]) => new RegExp(String.raw`\b(?:${alternatives.join('|')})\b`, 'i');

/**
 * Words that mean a sentence is about someone other than the patient, so a relative's diagnosis
 * or treatment is never recorded as the patient's. Informal terms ("mom") are listed
 * because notes use them. "family physician" is the author, not a relative, hence the lookahead.
 */
export const OTHER_PERSON = anyOf([
  'mother', 'father', 'mom', 'mum', 'mommy', 'mummy', 'dad', 'parents?', 'aunt', 'uncle', 'cousin', 'niece', 'nephew',
  'children', 'kids?', 'boyfriend', 'girlfriend', 'spouse', 'wife', 'husband', 'partner', 'roommate', 'brother', 'sister',
  'sibling', 'son', 'daughter', 'household', 'relatives?', 'friends?', 'colleagues?', 'coworkers?', 'neighbou?rs?',
  'flatmates?', 'housemates?', 'in-laws?',
  String.raw`family(?!\s+(?:physician|doctor|practice|practitioner|medicine|clinic))`,
  String.raw`grand(?:mother|father|parents?|ma|pa|dad|mom|son|daughter|child\w*)`, 'gran', 'granny', 'grannie', 'nan', 'nana', 'nanna',
  'step(?:mother|father|parent|son|daughter|brother|sister)',
]);

/**
 * Wording that makes a statement uncertain, a question, withdrawn, or a future intention; such
 * sentences are never used as facts. ("may" alone is not listed: it is also the month name.)
 */
const HEDGE_WORDS = anyOf([
  // doubt
  'rule[sd]? out', 'query', 'possible', 'possibly', 'suspected', 'probable', 'likely', 'unlikely', 'differential',
  'no evidence', 'not consistent', String.raw`r\/o`, 'might', 'could be', 'may be', 'may have', 'unclear', 'unknown', 'uncertain',
  'versus', 'vs', 'whether',
  // not established yet
  'not (?:yet |been )*(?:confirmed|established)', 'to be confirmed', 'will confirm', 'pending', 'awaiting', 'deferred',
  'not recorded', 'not documented', 'not asked', 'not discussed', 'not addressed', 'not known',
  'working diagnosis', 'to be reviewed', 'under review', 'being reviewed', 'to be clarified', 'to be determined',
  // withdrawn or corrected
  'in error', 'incorrect', String.raw`mislabel\w*`, 'wrong', 'retracted', 'removed',
]);
export const HEDGE = new RegExp(String.raw`${HEDGE_WORDS.source}|\?`, 'i');

/** Inhaled maintenance drugs, generic and common brand names. Relievers such as salbutamol are deliberately not listed. */
export const INHALED_STEM = anyOf([
  'fluticasone', 'budesonide', 'beclomethasone', 'beclometasone', 'mometasone', 'ciclesonide',
  'formoterol', 'salmeterol', 'vilanterol', 'indacaterol', 'olodaterol',
  'tiotropium', 'umeclidinium', 'glycopyrronium', 'aclidinium',
  'symbicort', 'advair', 'seretide', 'flovent', 'pulmicort', 'qvar', 'alvesco', 'breo', 'trelegy', 'dulera', 'spiriva',
  'fostair', 'serevent', 'foradil', 'onbrez', 'striverdi', 'anoro', 'incruse', 'arnuity', 'asmanex', 'bevespi',
  'spiolto', 'inspiolto', 'duaklir',
]);

/** Systemic corticosteroid names, including the terse "pred" and "OCS" (oral corticosteroids) used in notes. */
export const STEROID = anyOf([
  'prednisone', 'prednisolone', 'methylprednisolone', 'dexamethasone', 'hydrocortisone', 'cortisone', 'triamcinolone',
  'betamethasone', 'medrol', 'solu-?medrol', 'depo-?medrol', 'kenalog', 'celestone', 'cortef', 'deltasone', 'decadron',
  'orapred', 'pediapred', 'rayos', 'pred', 'ocs',
  String.raw`(?:oral|systemic)\s+(?:cortico)?steroids?`,
]);

/** Negation words. */
export const NEGATED = /\b(no|never|not|nil|denies|declined|refused|without)\b/i;
