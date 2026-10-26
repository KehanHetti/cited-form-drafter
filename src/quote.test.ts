import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteInDoc, cite, sentenceContaining } from './quote.js';
import type { Doc } from './draft.js';

const doc: Doc = {
  doc_id: 'A09', date: '2026-06-30', type: 'lab_report', author_role: 'laboratory',
  text: 'Complete blood count. Collected 2026-06-28. Eosinophils 0.45 x10^9/L.',
};

test('quoteInDoc accepts exact substrings only', () => {
  assert.equal(quoteInDoc(doc, 'Eosinophils 0.45 x10^9/L.'), true);
  assert.equal(quoteInDoc(doc, 'eosinophils 0.45 x10^9/L.'), false);
  assert.equal(quoteInDoc(doc, 'Eosinophils were 0.45'), false);
  assert.equal(quoteInDoc(doc, ''), false);
});

test('cite throws when the quote is not in the document', () => {
  assert.deepEqual(cite(doc, 'Collected 2026-06-28.'), { doc_id: 'A09', quote: 'Collected 2026-06-28.' });
  assert.throws(() => cite(doc, 'Collected 2026-06-29.'));
});

test('sentenceContaining returns the exact slice and does not split decimals', () => {
  assert.equal(sentenceContaining(doc, /Eosinophils/), 'Eosinophils 0.45 x10^9/L.');
  assert.equal(sentenceContaining(doc, /Collected/), 'Collected 2026-06-28.');
  assert.equal(sentenceContaining(doc, /platelets/), null);
});
