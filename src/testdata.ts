import { readFileSync } from 'node:fs';
import type { Doc, FormField } from './draft.js';

// Chart A, read from the kit, for tests that check real wording.
export const chartA: Doc[] = JSON.parse(readFileSync('chart-A/documents.json', 'utf8'));
export const demoA: Record<string, unknown> = JSON.parse(readFileSync('chart-A/demographics.json', 'utf8'));
export const FORM_DATE = '2026-11-15';

export function field(field_id: string, cls: string): FormField {
  return { field_id, label: field_id, class: cls, answer_type: 'text' };
}

export function doc(doc_id: string, date: string, text: string, type = 'clinic_note', author_role = 'family_physician'): Doc {
  return { doc_id, date, type, author_role, text };
}
