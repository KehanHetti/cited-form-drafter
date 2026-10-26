import type { Doc, FieldDraft, FormField } from './draft.js';
import { cite, sentenceContaining } from './quote.js';
import { drafted, needsPhysician, notDocumented } from './result.js';

// Demographic fields come from demographics.json only, never from note text.
export function draftDemographic(f: FormField, demo: Record<string, unknown>): FieldDraft {
  const v = demo[f.field_id];
  if (typeof v !== 'string' || !v.trim()) return notDocumented(f);
  return drafted(f, v, [{ doc_id: 'demographics', quote: `${f.field_id}: ${v}` }]);
}

// Opinion and physician-entered fields are never filled. For the opinion field we
// attach sentences that may help the physician decide.
const HELPFUL = /\b(symptomatic|poorly controlled|inadequately controlled|uncontrolled|high-dose inhaled corticosteroid)\b/i;

export function draftPhysicianOnly(f: FormField, docs: Doc[]): FieldDraft {
  if (f.class !== 'OPINION_PHYSICIAN') return needsPhysician(f);
  const citations = [];
  for (const d of docs) {
    const s = sentenceContaining(d, HELPFUL);
    if (s) citations.push(cite(d, s));
  }
  return needsPhysician(f, citations);
}
