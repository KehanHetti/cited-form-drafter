// Codex co-op work sample: starter stub. Replace the TODOs; keep the CLI and output shape.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type Status = 'DRAFTED' | 'NEEDS_PHYSICIAN' | 'NOT_DOCUMENTED';
export interface Citation { doc_id: string; quote: string }
export interface Computation { rule: string; inputs: Citation[] }
export interface FieldDraft {
  field_id: string;
  status: Status;
  value: string | number | boolean | null;
  citations: Citation[];
  computation: Computation | null;
}
export interface Doc { doc_id: string; date: string; type: string; author_role: string; text: string }
export interface FormField { field_id: string; label: string; class: string; answer_type: string }
export interface Form { form_id: string; title: string; form_date: string; fields: FormField[] }

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`missing --${name}`);
  return process.argv[i + 1];
}

function main(): void {
  const chartDir = arg('chart');
  const form: Form = JSON.parse(readFileSync(arg('form'), 'utf8'));
  const docs: Doc[] = JSON.parse(readFileSync(join(chartDir, 'documents.json'), 'utf8'));
  const demographics = JSON.parse(readFileSync(join(chartDir, 'demographics.json'), 'utf8'));
  void docs; void demographics;

  // TODO: draft each field under the rules in README.md. The stub abstains on everything.
  const fields: FieldDraft[] = form.fields.map((f) => ({
    field_id: f.field_id, status: 'NOT_DOCUMENTED', value: null, citations: [], computation: null,
  }));

  const out = arg('out');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ chart: chartDir, form_id: form.form_id, fields }, null, 2));
}

if (process.argv[1]?.endsWith('draft.js')) main();
