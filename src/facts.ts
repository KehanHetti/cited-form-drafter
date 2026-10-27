/** FACTUAL_CITED fields: diagnosis and prior biologic. */
import { Doc, FieldDraft, FormField, cite, datesIn, drafted, hasDate, notDocumented, sentences, stripSemicolon,
  HEDGE, INHALED_STEM, NEGATED, OTHER_PERSON, STEROID, anyOf } from './helpers.js';

// -- diagnosis --

/** A sentence must carry one of these cues to count as a diagnosis; "asthma" alone also appears in histories and plans. */
const DIAGNOSIS_CUE = /\b(impression|assessment|diagnos\w*|dx)\b|^\s*a\s*:/i;  // "A:" is the assessment line of a SOAP note
/** Matches the type as written ("severe eosinophilic asthma") so the value keeps its qualifiers instead of a bare "asthma". */
const SEVERITY_OR_TYPE = 'mild|moderate|severe|persistent|intermittent|eosinophilic|allergic|atopic|difficult-to-treat';
const DIAGNOSIS_PHRASE = new RegExp(
  // qualifiers before: "severe eosinophilic asthma", "mild-to-moderate asthma"
  String.raw`\b(?:(?:${SEVERITY_OR_TYPE})(?:[\s-]+to[\s-]+|[\s-]+))*asthma\b` +
  // qualifiers after: "asthma, moderate persistent"
  String.raw`(?:,\s*(?:mild|moderate|severe)(?:\s+(?:persistent|intermittent))?(?:,?\s+(?:eosinophilic|allergic|atopic)\b)?)?`,
  'i',
);
/** Another condition or a sub-type in the same sentence: the bare word "asthma" would misstate it. */
const DIAGNOSIS_QUALIFIER = /\b(copd|overlap|cough[- ]variant|occupational|exercise[- ]induced|aspirin|bronchiectasis)\b/i;
/** Before the phrase: the patient does not have it, or it is history. */
const NEGATED_BEFORE = anyOf([
  'not', 'no', 'without', 'negative for', 'denies', 'never', 'history of', 'hx of', 'past', 'childhood', 'resolved',
  'remission', 'withdrawn', 'withdrew', 'retracted',
]);
/** Right after the phrase (within three words): it was excluded. */
const NEGATED_AFTER = new RegExp(String.raw`^\W*(?:\w+\s+){0,3}?${anyOf([
  'excluded', 'ruled out', 'resolved', 'unlikely', 'negative', 'in remission', 'withdrawn', 'revised', 'retracted',
  'refuted', 'no longer', 'not supported', 'inactive', 'not (?:currently |now )?(?:active|present)',
]).source}`, 'i');

type DiagnosisVerdict =
  | { kind: 'asserts'; phrase: string }
  | { kind: 'negates' }   // the document says the patient does NOT have it
  | { kind: 'unclear' }   // hedged, about someone else, or mixed with another condition
  | null;                 // not about a diagnosis at all

/**
 * Reads one sentence as a statement about the patient's asthma diagnosis. `cue` is the wording that
 * marks a diagnostic statement (confirmation counts for the respirologist check).
 */
export function classifyDiagnosis(s: string, cue: RegExp = DIAGNOSIS_CUE, specialist = false): DiagnosisVerdict {
  // A specialist writing about asthma is stating a diagnosis even without a cue word ("seen for asthma, severe persistent").
  if ((!cue.test(s) && !specialist) || !/\b(asthma|copd)\b/i.test(s)) return null;
  const m = DIAGNOSIS_PHRASE.exec(s);
  // "Impression: COPD." names another condition (unclear); "COPD was considered but excluded" says nothing about asthma.
  if (!m) return /\b(excluded|ruled out|negative|not)\b/i.test(s) ? null : { kind: 'unclear' };
  // "Dx: asthma exacerbation" names an episode of the disease, not the diagnosis itself.
  if (/^\s+(?:exacerbations?|attacks?|flares?|flare-?ups?)\b/i.test(s.slice(m.index + m[0].length))) return null;
  if (NEGATED_BEFORE.test(s.slice(0, m.index)) || NEGATED_AFTER.test(s.slice(m.index + m[0].length))) {
    return { kind: 'negates' };
  }
  if (HEDGE.test(s) || OTHER_PERSON.test(s) || DIAGNOSIS_QUALIFIER.test(s)) return { kind: 'unclear' };
  return { kind: 'asserts', phrase: m[0] };
}

/** Judged by author_role, not note text: any note can say "referred to respirology". */
export const isSpecialist = (d: Doc) => /(?:respirolog|pulmonolog)ist/i.test(d.author_role);

/** "Asthma" with no type or severity, as opposed to e.g. "severe eosinophilic asthma". */
const isGeneric = (phrase: string) => phrase.trim().toLowerCase() === 'asthma';

/**
 * The newest document that speaks to the diagnosis governs. If that document excludes asthma or is
 * not clear, we abstain: falling back to an older document would report a superseded diagnosis.
 * One refinement: when the newest statement is the bare word "asthma", an older, more specific
 * statement of the same disease is used instead, unless a note in between excluded it.
 */
export function diagnosis(f: FormField, docs: Doc[]): FieldDraft {
  let generic: { d: Doc; s: string; phrase: string } | null = null;
  const fromGeneric = () => (generic ? drafted(f, generic.phrase, [cite(generic.d, stripSemicolon(generic.s))]) : notDocumented(f));
  for (const d of docs) {
    // Whole clauses, not split at ";": "Assessment: asthma plan updated; diagnosis under review" is one statement.
    const verdicts = sentences(d, false).map((s) => ({ s, v: classifyDiagnosis(s, DIAGNOSIS_CUE, isSpecialist(d)) })).filter((x) => x.v !== null);
    if (!verdicts.length) continue;  // says nothing about the diagnosis, so an older note may still govern
    // The newest note that speaks to the diagnosis ends the search, even if it withdraws it.
    if (verdicts.some((x) => x.v!.kind === 'negates')) return fromGeneric();
    // Within one note prefer the most specific statement ("Impression: severe allergic asthma") over a bare one.
    const asserted = verdicts.filter((x) => x.v!.kind === 'asserts');
    const hit = asserted.find((x) => !isGeneric((x.v as { phrase: string }).phrase)) ?? asserted[0];
    if (!hit) return fromGeneric();
    const phrase = (hit.v as { phrase: string }).phrase;
    if (!isGeneric(phrase)) return drafted(f, phrase, [cite(d, stripSemicolon(hit.s))]);
    // A bare "asthma" is kept as a fallback only; an older, more specific type of the same disease can still refine it.
    generic ??= { d, s: hit.s, phrase };
  }
  return fromGeneric();
}

// -- prior biologic --

const BIOLOGIC = anyOf([
  'omalizumab', 'xolair', 'mepolizumab', 'nucala', 'benralizumab', 'fasenra', 'dupilumab', 'dupixent',
  'tezepelumab', 'tezspire', 'reslizumab', 'cinqair',
]);
/** The sentence must report something that happened (start, stop, restart, outcome)... */
const BIO_EVENT = anyOf([
  'start(?:ed)?', 'restart(?:ed)?', 'resumed', 'began', 'initiated', 'commenced', 'stopp?ed', 'discontinued',
  String.raw`d\/c(?:'?d)?`, 'completed', 'received', 'ceased', 'switched', 'failed', 'lack of response', 'no response',
  'response', 'tolerated', 'dose increased', 'first dose', 'start date', 'stop date', 'dispensed', 'administered',
]);
/** ...and must not be a plan or discussion of a future option. */
const PLAN_WORDS = ['plan', String.raw`consider\w*`, String.raw`discuss\w*`, 'eligible', 'candidate', 'proposed', 'pending', 'would', 'if'];
const BIO_NOT_EVENT = anyOf([...PLAN_WORDS, String.raw`recommend\w*`]);
/** As above without "recommend": in "started 2025-01-14 after respirology recommendation" it is the reason, not a plan. */
const BIO_NOT_EVENT_NO_REASON = anyOf(PLAN_WORDS);
/** "no response" and "stopped" are negative words that still describe a real trial. */
const NEGATIVE_BUT_REAL = /\bstopp?ed|stop date|discontinued|d\/c|lack of response|no response\b/i;

/** Wording that says a biologic ended: stopped, last given, or a "from X to Y" range. */
const STOP_EVIDENCE = new RegExp([
  anyOf(['stopp?ed', 'stop date', 'end date', 'discontinued', String.raw`d\/c(?:'?d)?`, 'ceased', 'completed', 'ended', 'withdrawn', 'last (?:dose|given)']).source,
  String.raw`\bfrom\b.{0,40}\bto\b`,
].join('|'), 'i');

interface BiologicEvent { d: Doc; s: string; drug: string }
/** A sentence right after the drug is named that gives when it was started or first given... */
const START_START = /^\s*(?:first dose|start date|started|began|commenced)\b/i;
/** ...or when it was stopped. */
const STOP_START = /^\s*(?:stopp?ed|discontinued|d\/c|ceased|stop date)\b/i;

/**
 * Gathers every event sentence about a biologic the patient received, oldest first, so start, stop
 * and outcome read in order. A sentence that only names the drug (a prescription, a dispensing
 * note) counts when the next sentence gives the start date. The form asks for dates, so an account
 * with no date at all is not drafted.
 */
export function priorBiologic(f: FormField, docs: Doc[]): FieldDraft {
  const events: BiologicEvent[] = [];
  for (const d of [...docs].reverse()) {
    const ss = sentences(d, false); // keep "started ...; stopped ..." together
    ss.forEach((s, i) => {
      const drug = BIOLOGIC.exec(s)?.[0].toLowerCase();
      if (!drug || OTHER_PERSON.test(s)) return;
      // "Start mepolizumab" is an order that may never have happened. With a date, terse notes use the
      // same wording to record that it did ("Start mepolizumab 2025-05-01").
      const isOrder = /^\s*(?:start|begin|initiate|commence)\b/i.test(s) && !hasDate(s);
      const startedOnDate = /\b(?:started|commenced|began)\b/i.test(s) && datesIn(s).some((x) => x <= d.date);
      if ((startedOnDate ? BIO_NOT_EVENT_NO_REASON : BIO_NOT_EVENT).test(s) || isOrder) return;
      if (BIO_OTHER_INDICATION.test(s) && !/\basthma\b/i.test(s)) return;
      if (NEGATED.test(s) && !NEGATIVE_BUT_REAL.test(s)) return;
      if (/\b(not|never|declined)\b[^.]{0,30}\b(start|begin|initiat|receiv|given|trial)/i.test(s)) return;
      // The next sentence may complete the story ("... started 2024-03-01. Stopped 2024-09-01, partial response.").
      const kind = biologicEventKind(s);
      const next = ss[i + 1] ?? '';
      // ...but only if that sentence is about this drug, not another person, condition or medicine.
      const aboutSomethingElse = [BIOLOGIC, OTHER_PERSON, BIO_OTHER_INDICATION, STEROID, INHALED_STEM].some((re) => re.test(next));
      const givesStop = kind !== 'stop' && kind !== 'both' && STOP_START.test(next);
      const givesStart = kind !== 'start' && kind !== 'both' && START_START.test(next);
      const completes =
        hasDate(next) && !aboutSomethingElse && (!NEGATED.test(next) || NEGATIVE_BUT_REAL.test(next)) && (givesStop || givesStart);
      if (BIO_EVENT.test(s) || completes) events.push({ d, s: stripSemicolon(s), drug });
      if (completes) events.push({ d, s: stripSemicolon(next), drug });
    });
  }
  // A restart means the drug may be current again, so it is not a prior trial we can summarise.
  if (events.some((e) => biologicEventKind(e.s) === 'restart')) return notDocumented(f);
  if (!events.length || hasDateConflict(events) || !events.some((e) => hasDate(e.s))) return notDocumented(f);
  // The form asks for a PRIOR biologic with stop dates: a drug still being given is not one, and
  // "stopped today" gives no date we can copy.
  if (!events.some((e) => STOP_EVIDENCE.test(e.s) && hasDate(e.s))) return notDocumented(f);
  return drafted(f, events.map((e) => e.s).join(' '), events.map((e) => cite(e.d, e.s)));
}

/** Other conditions a biologic is given for. A sentence about them, with no mention of asthma, is not an asthma trial. */
const BIO_OTHER_INDICATION = anyOf([
  'eczema', 'atopic dermatitis', 'urticaria', 'hives', 'nasal polyps?', 'polyposis', 'rhinosinusitis', 'esophagitis',
  'prurigo', 'pemphigoid', 'psoriasis', 'COPD',
]);

/** Whether a sentence reports the start, the stop, both, a restart, or neither. */
function biologicEventKind(s: string): 'start' | 'stop' | 'both' | 'restart' | 'other' {
  if (/\b(restart(?:ed)?|resumed)\b/i.test(s)) return 'restart';
  const start = /\b(start(?:ed)?|start date|commenced|began|initiated)\b/i.test(s);
  const stop = /\b(stopp?ed|stop date|discontinued|d\/c|ceased)\b/i.test(s);
  return start && stop ? 'both' : start ? 'start' : stop ? 'stop' : 'other';
}

/** Which of "start" and "stop" a sentence reports (a sentence can report both). */
function eventsCovered(s: string): Set<'start' | 'stop'> {
  const kind = biologicEventKind(s);
  return new Set(kind === 'both' ? ['start', 'stop'] : kind === 'start' || kind === 'stop' ? [kind] : []);
}

/**
 * Two different start (or stop) dates for one drug, or one sentence with more dates than events
 * ("started 2025-01-10 (elsewhere 2025-02-10)"), are a conflict. Which date is right cannot be told,
 * so the field is left blank.
 */
function hasDateConflict(events: BiologicEvent[]): boolean {
  if (events.some((e) => eventsCovered(e.s).size > 0 && new Set(datesIn(e.s)).size > eventsCovered(e.s).size)) return true;
  return [...new Set(events.map((e) => e.drug))].some((drug) =>
    (['start', 'stop'] as const).some((kind) => {
      // A sentence that gives both counts for each: its first date is the start and its last is the stop.
      const dates = events.filter((e) => e.drug === drug && eventsCovered(e.s).has(kind))
        .map((e) => { const ds = datesIn(e.s); return kind === 'start' ? ds[0] : ds[ds.length - 1]; });
      return new Set(dates).size > 1;
    }));
}
