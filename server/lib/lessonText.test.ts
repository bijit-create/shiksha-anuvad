import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAll, validate, foreignLetters } from './lessonText.js';
import { pluginRefusal, pluginUser } from './pluginAuth.js';
import type { GlossaryEntry } from './glossary.js';

const shadow: GlossaryEntry = {
  termId: 1, en: 'shadow', sense: 'dark area where light is blocked', subject: 'Science',
  gradeMin: 1, gradeMax: 12, target: 'छाया', variants: ['परछाई'], status: 'candidate',
};
const ctx = (matches: any[] = []) => ({ matches });

test('flags a changed placeholder, a missing string and an extra key', () => {
  const src = { a: '{who} is {d} cm from the lamp.', b: 'Tap the lamp.' };
  const { findings } = checkAll(src, { a: '{who} दीपक से सेमी दूर है।', c: 'x' },
    { a: ctx(), b: ctx() }, new Set(), 1, '6-10', false);
  const keys = findings.map(f => `${f.key}:${f.test}`);
  assert.ok(keys.includes('a:E1'), 'placeholder {d} dropped');
  assert.ok(keys.includes('b:E1'), 'b missing');
  assert.ok(keys.includes('c:E1'), 'c not an input key');
});

test('placeholders are not counted as numbers or English left in', () => {
  const { findings } = checkAll({ a: 'The shadow is {h} cm tall.' }, { a: 'छाया {h} सेमी लंबी है।' },
    { a: ctx([{ en: 'shadow', options: [shadow] }]) }, new Set(), 1, '6-10', true);
  assert.deepEqual(findings, []);
});

test('numbers must be copied digit for digit', () => {
  const { findings } = checkAll({ a: 'Move it 30 cm.' }, { a: 'इसे 20 सेमी खिसकाओ।' },
    { a: ctx() }, new Set(), 1, '6-10', false);
  assert.equal(findings[0]?.test, 'E7');
});

test('the batch report lists each glossary term once, found only if every string used it', () => {
  const m = [{ en: 'shadow', options: [shadow] }];
  const { glossary, findings } = checkAll(
    { a: 'The shadow grows.', b: 'Look at the shadow.' },
    { a: 'छाया बढ़ती है।', b: 'अँधेरे को देखो।' },
    { a: ctx(m), b: ctx(m) }, new Set(), 1, '6-10', true);
  assert.equal(glossary!.terms.length, 1);
  assert.equal(glossary!.terms[0].found, false);
  assert.ok(findings.some(f => f.key === 'b' && f.test === 'E6'));
});

test('validate rejects an empty batch and a batch that is too large', () => {
  assert.throws(() => validate({ targetLanguage: 'Hindi', strings: {} }), /nothing to translate/);
  assert.throws(() => validate({ targetLanguage: 'Hindi', strings: { a: 'x'.repeat(30_000) } }), /at most/);
  assert.equal(validate({ targetLanguage: 'Hindi', strings: { a: 'Tap.', b: ' ' } }).strings.b, undefined);
});

test('plugin callers need the current code and a team Claude account', () => {
  process.env.PLUGIN_CODE = 'test-plugin-code-123456';
  const ok = { code: 'test-plugin-code-123456', user: { email: 'someone@convegenius.ai' } };
  assert.equal(pluginRefusal(ok, pluginUser(ok)), null);
  const wrong = { ...ok, code: 'old' };
  assert.equal(pluginRefusal(wrong, pluginUser(wrong))?.status, 401);
  const outsider = { ...ok, user: { email: 'someone@gmail.com' } };
  assert.equal(pluginRefusal(outsider, pluginUser(outsider))?.status, 403);
  const none = { ...ok, user: {} };
  assert.equal(pluginRefusal(none, pluginUser(none))?.status, 403);
});

test('a model outside the allowed list is refused', () => {
  assert.throws(() => validate({ targetLanguage: 'Hindi', model: 'gemini-9-ultra', strings: { a: 'Tap.' } }), /model must be one of/);
  assert.equal(validate({ targetLanguage: 'Hindi', model: 'gemini-3.8-flash', strings: { a: 'Tap.' } }).model, 'gemini-3.8-flash');
});

test('letters from another script are flagged (Bengali inside Odia), the shared danda is not', () => {
  assert.deepEqual(foreignLetters('Odia', 'ଆଲୋକିତ ହୁଏ।'), []);
  assert.deepEqual(foreignLetters('Odia', 'উଜ୍ଜ୍ୱଳ'), ['উ']);
  assert.deepEqual(foreignLetters('Hindi', 'दीपक जलाओ।'), []);
  const { findings } = checkAll({ a: 'The screen is bright.' }, { a: 'ପରଦା উଜ୍ଜ୍ୱଳ।' }, { a: { matches: [] } }, new Set(), 1, '6-10', false, 'Odia');
  assert.equal(findings[0]?.test, 'E2');
});
