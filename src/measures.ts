/** VERBATIM_DATED and COMPUTED_CITED fields: the eosinophil count, respirologist confirmation, and the steroid count (left blank). */
import { Doc, FieldDraft, FormField, addMonths, cite, drafted, notDocumented, parseDate,
  sentences, stripSemicolon, withinMonths, DATE_TOKEN } from './helpers.js';
import { classifyDiagnosis, isSpecialist } from './facts.js';

// -- Eosinophil count (VERBATIM_DATED) --

/**
 * An absolute eosinophil count with its unit. The unit is required: without it 0.45 cannot be told from
 * 450, and copying a number under the wrong unit is a plausible-looking wrong value. Percentages do not match.
 */
const EOSINOPHIL_VALUE = new RegExp(
  '\\b(?:eosinophils?|eos)\\b[^0-9%]{0,30}?(\\d+(?:\\.\\d+)?)\\s*(?:\\(abs(?:olute)?\\)\\s*)?(?:units?\\s*:\\s*)?(' +
  'x\\s*10\\s*[\\^*]\\s*\\d+\\s*\\/\\s*L|×\\s*10\\^\\d+\\s*\\/\\s*L|10\\s*[\\^*]\\s*9\\s*\\/\\s*L|x\\s*10E9\\s*\\/\\s*L' +
  '|cells\\s*\\/\\s*(?:[uµμ]L|mcL|mm3)|\\/\\s*(?:[uµμ]L|mcL|mm3)|per\\s*(?:[uµμ]L|mcL|mm3)|G\\/L|K\\/[uµμ]L|x\\s*10\\^?3\\s*\\/\\s*[uµμ]L)',
  'i',
);

/** An eosinophil number we may be unable to read (odd unit, no date) that is not a percentage. */
const MENTIONS_COUNT = /\beos(?:inophils?)?\b[^.%\d]{0,25}\d+(?:\.\d+)?(?!\.?\d)(?!\s*%)/i;

/** An eosinophil result given only as a percentage: it cannot be copied as a count, but it can be newer. */
const PERCENT_ONLY = /\beos(?:inophils?)?\b[^.\d]{0,25}\d+(?:\.\d+)?\s*%/i;

/** Wording that introduces the date the sample was taken. */
const DATE_CUE = /\b(?:collect(?:ed|ion)|coll|drawn|draw date|sampled)\b/i;
/** Samples that are not blood: their eosinophil count is not the blood count the form asks for. */
const NOT_BLOOD = /\b(?:sputum|bal|lavage|nasal|urine|stool|tissue|biops\w*|bronch\w*|smear)\b/i;

interface LabResult { doc: Doc; collected: string; num: string; unit: string; valueSentence: string; dateSentence: string }

/**
 * Reads every blood eosinophil count in one document with its collection date. The date comes from the
 * "collected" sentence nearest the value (the earlier one on a tie), so a reference to a previous
 * sample cannot date this result. When a note holds several results, each must carry its own date
 * in its own sentence, since a shared nearest date would give one of them the wrong day.
 */
function readLabs(doc: Doc): LabResult[] {
  const ss = sentences(doc);
  const values = ss.flatMap((s, i) => (EOSINOPHIL_VALUE.test(s) && !NOT_BLOOD.test(s) ? [i] : []));
  const results: LabResult[] = [];
  for (const vi of values) {
    let best: { i: number; collected: string } | null = null;
    ss.forEach((s, i) => {
      if (!DATE_CUE.test(s) || /\b(previous|prior|earlier|last)\b/i.test(s)) return;
      const token = DATE_TOKEN.exec(s.slice(s.search(DATE_CUE)));
      const collected = token && parseDate(token[0]);
      if (!collected) return;
      const closer = !best || Math.abs(i - vi) < Math.abs(best.i - vi) || (Math.abs(i - vi) === Math.abs(best.i - vi) && i < vi);
      if (closer) best = { i, collected };
    });
    // Never fall back to the report date: a reprint is dated when it was printed, not when the sample was drawn (chart A, A10).
    const found = best as { i: number; collected: string } | null;
    if (!found || (values.length > 1 && found.i !== vi)) return [];
    const m = EOSINOPHIL_VALUE.exec(ss[vi])!;
    results.push({ doc, collected: found.collected, num: m[1], unit: m[2], valueSentence: ss[vi], dateSentence: ss[found.i] });
  }
  return results;
}

/** Drafts the most recent eosinophil count from date-filtered documents (newest first). */
export function draftLab(f: FormField, docs: Doc[], formDate: string): FieldDraft {
  let best: LabResult | null = null;
  const undated: Doc[] = [];  // eosinophil results that might be newer than `best` but that we cannot use
  for (const d of docs) {
    if (!/\beos(inophils?)?\b/i.test(d.text)) continue;
    const rs = readLabs(d);
    // A count we could not read (unknown unit or no collection date) may still be the newest result.
    // Likewise a percentage-only result: it cannot be copied as a count, but it may supersede an older count.
    if (!rs.length && (MENTIONS_COUNT.test(d.text) || PERCENT_ONLY.test(d.text))) undated.push(d);
    // Compare collection dates, not report dates, so a reprint of an old sample cannot beat a newer one.
    for (const r of rs) if (r.collected <= formDate && (!best || r.collected > best.collected)) best = r;
  }
  if (!best) return notDocumented(f);
  // An unusable result reported after `best` was collected might be the true latest: abstain rather than
  // present an older value as the most recent.
  if (undated.some((d) => d.date > best!.collected)) return notDocumented(f);
  const quotes = [...new Set([best.valueSentence, best.dateSentence])];
  return drafted(f, `${best.num} ${best.unit} (collected ${best.collected})`, quotes.map((q) => cite(best!.doc, q)));
}

// -- Steroid courses and respirologist confirmation (COMPUTED_CITED) --

const RESPIROLOGIST_WINDOW_MONTHS = 24;

/**
 * Deliberately never drafted. A count needs every systemic steroid found and each one tied to an asthma
 * exacerbation, and a fixed drug list cannot promise that: a missed steroid gives a count that is too low
 * and looks right. A blank costs the physician seconds.
 */
export function steroidCourses(f: FormField): FieldDraft {
  return notDocumented(f);
}

/**
 * True when a respirologist's own dated note inside the window states the diagnosis; otherwise
 * blank. The newest respirologist note governs, so one that withdraws asthma ends the search.
 */
export function respirologistConfirmed(f: FormField, docs: Doc[], formDate: string): FieldDraft {
  const cue = /\b(impression|assessment|diagnos\w*|dx|(?:re)?confirm\w*)\b/i;
  const start = addMonths(formDate, -RESPIROLOGIST_WINDOW_MONTHS);
  for (const d of docs) {  // newest first
    if (!isSpecialist(d)) continue;
    const verdicts = sentences(d).map((s) => ({ s, v: classifyDiagnosis(s, cue, true) })).filter((x) => x.v !== null);
    // A newer respirologist note that withdraws the diagnosis ends the search; an older confirmation must not stand.
    if (verdicts.some((x) => x.v!.kind === 'negates')) break;
    const asserted = verdicts.filter((x) => x.v!.kind === 'asserts');
    // Cite an explicit statement ("I confirm ...", "Impression: ...") over a bare mention such as "Asthma follow-up."
    const hit = asserted.find((x) => cue.test(x.s)) ?? asserted[0];
    if (!hit || !withinMonths(d.date, formDate, RESPIROLOGIST_WINDOW_MONTHS)) continue;
    // A later note by anyone that withdraws the diagnosis (e.g. a family physician relaying it) overrides the confirmation.
    if (docs.some((x) => x.date > d.date && sentences(x).some((s) => classifyDiagnosis(s)?.kind === 'negates'))) break;
    const inputs = [cite(d, stripSemicolon(hit.s))];
    const rule = `True if a respirologist document dated after ${start} and on or before ${formDate} states or confirms the asthma diagnosis.`;
    return drafted(f, true, inputs, { rule, inputs });
  }
  // Only a confirmation inside the window is an answer. An older one, or none, leaves the field blank:
  // "false" would claim there is no newer confirmation, which the chart cannot show.
  return notDocumented(f);
}
