import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkText } from './checks.js';
import { checkOutput, type GlossaryEntry } from './glossary.js';

const side: GlossaryEntry = {
  termId: 1,
  en: 'side',
  sense: 'bounding line segment of a polygon',
  subject: 'Mathematics',
  gradeMin: 1,
  gradeMax: 12,
  target: 'ਪਾਸਾ',
  variants: [],
  status: 'candidate',
};

function report(text: string, options = [side]) {
  return checkOutput(text, [{ en: side.en, options }], new Set(), 1, '6-10').terms[0];
}

test('accepts Punjabi direct and oblique plurals and keeps the glossary headword', () => {
  for (const text of [
    'ਇੱਕ ਤਿਕੋਣ ਦੇ ਤਿੰਨ ਪਾਸੇ ਹੁੰਦੇ ਹਨ।',
    'ਤਿੰਨ ਪਾਸਿਆਂ ਤੋਂ',
    'ਇੱਕ ਪਾਸਾ',
  ]) {
    const term = report(text);
    assert.equal(term.found, true, text);
    assert.equal(term.target, 'ਪਾਸਾ');
  }
});

test('keeps missing terms flagged and rejects generated forms inside another word', () => {
  for (const text of ['ਇੱਕ ਤਿਕੋਣ ਦੇ ਤਿੰਨ ਕਿਨਾਰੇ ਹਨ।', 'ਚੁਪਾਸੇ', 'ਪਾਸੇਵਾਲਾ']) {
    assert.equal(report(text).found, false, text);
  }
});

test('accepts inflected phrases and variants and prefers a literal match', () => {
  assert.equal(report('ਲੰਮੇ ਪਾਸੇ ਹਨ।', [{ ...side, target: 'ਲੰਮਾ ਪਾਸਾ' }]).found, true);
  assert.equal(report('ਤਿੰਨ ਪਾਸੇ', [{ ...side, target: 'ਕਿਨਾਰਾ', variants: ['ਪਾਸਾ'] }]).found, true);
  assert.equal(report('ਪਾਸੇ ਅਤੇ ਕਿਨਾਰਾ', [side, { ...side, target: 'ਕਿਨਾਰਾ' }]).target, 'ਕਿਨਾਰਾ');
  assert.equal(report('तीन भुजाएँ', [{ ...side, target: 'भुजा' }]).found, true);
});

test('does not raise a glossary finding for the Punjabi plural', () => {
  const result = checkText(
    'A triangle has three sides.',
    'ਇੱਕ ਤਿਕੋਣ ਦੇ ਤਿੰਨ ਪਾਸੇ ਹੁੰਦੇ ਹਨ।',
    [{ en: side.en, options: [side] }],
    new Set(),
    1,
    '6-10',
  );
  assert.deepEqual(result.findings, []);
});
