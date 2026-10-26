import type { Citation, Computation, FieldDraft, FormField } from './draft.js';

export function drafted(
  f: FormField, value: string | number | boolean, citations: Citation[], computation: Computation | null = null,
): FieldDraft {
  return { field_id: f.field_id, status: 'DRAFTED', value, citations, computation };
}

export function notDocumented(f: FormField): FieldDraft {
  return { field_id: f.field_id, status: 'NOT_DOCUMENTED', value: null, citations: [], computation: null };
}

export function needsPhysician(f: FormField, citations: Citation[] = []): FieldDraft {
  return { field_id: f.field_id, status: 'NEEDS_PHYSICIAN', value: null, citations, computation: null };
}
