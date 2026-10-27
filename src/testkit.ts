import { readFileSync } from 'node:fs';
import { draftForm } from './draft.js';
import type { Doc, FieldDraft, Form } from './helpers.js';

/** Shared fixtures for the tests: chart A from the kit, the form, and small builders. */
export const chartA: Doc[] = JSON.parse(readFileSync('chart-A/documents.json', 'utf8'));
export const demoA: Record<string, unknown> = JSON.parse(readFileSync('chart-A/demographics.json', 'utf8'));
export const chartB: Doc[] = JSON.parse(readFileSync('chart-B/documents.json', 'utf8'));
export const demoB: Record<string, unknown> = JSON.parse(readFileSync('chart-B/demographics.json', 'utf8'));
export const form: Form = JSON.parse(readFileSync('form/F-DEMO-01.json', 'utf8'));

export function doc(doc_id: string, date: string, text: string, author_role = 'family_physician', type = 'clinic_note'): Doc {
  return { doc_id, date, type, author_role, text };
}

/** Drafts one field of the real form from a small invented chart. */
export function run(fieldId: string, docs: Doc[], demo: Record<string, unknown> = {}): FieldDraft {
  const field = form.fields.find((f) => f.field_id === fieldId)!;
  return draftForm({ ...form, fields: [field] }, docs, demo)[0];
}
