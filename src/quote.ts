import type { Citation, Doc } from './draft.js';

export function quoteInDoc(doc: Doc, quote: string): boolean {
  return quote.length > 0 && doc.text.includes(quote);
}

export function cite(doc: Doc, quote: string): Citation {
  if (!quoteInDoc(doc, quote)) throw new Error(`quote not in ${doc.doc_id}: ${quote}`);
  return { doc_id: doc.doc_id, quote };
}

// Sentence boundaries are . ! ? followed by whitespace or end, so "0.45" is not split.
export function sentences(doc: Doc): string[] {
  const out: string[] = [];
  const end = /[.!?;](?=\s|$)/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = end.exec(doc.text))) {
    out.push(doc.text.slice(start, m.index + 1).trim());
    start = m.index + 1;
  }
  const rest = doc.text.slice(start).trim();
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

export function sentenceContaining(doc: Doc, pattern: RegExp): string | null {
  return sentences(doc).find((s) => pattern.test(s)) ?? null;
}
