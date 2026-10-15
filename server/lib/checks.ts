import { checkOutput, GlossaryReport, TermMatch, Band } from './glossary.js';

// Deterministic checks after translation, one per T-QSI test that code can decide.
// A finding tells the repair pass exactly what to fix; checks never judge style.

export interface Item {
  question: string;
  options: string[];
  answer: string;
}

export interface Finding {
  test: string;      // T-QSI test code (E1 structure, E3 key, E6 term, E7 numbers, E8 English left in)
  field: string;     // stem, option n, key, text
  problem: string;   // what is wrong, in words the model can act on
}

const IMAGE_RE = /\[image\]\s*\S+|\/uploads\/\S+/gi;
const MATH_RE = /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$/g;

export const stripImages = (s: string) => (s || '').replace(IMAGE_RE, ' ');
const images = (s: string) => ((s || '').match(IMAGE_RE) || []).map(x => x.trim()).sort();
const blanks = (s: string) => ((s || '').match(/_{3,}|#/g) || []).length;
const parts = (s: string) => (s || '').split('$').length;
const norm = (s: string) => (s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/** Numbers as written (digits, with decimal point or separators), outside image paths. */
export function numbers(s: string): string[] {
  return (stripImages(s).match(/\d+(?:[.,]\d+)*/g) || []).map(n => n.replace(/,/g, '')).sort();
}

function sameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export const fieldsOf = (it: Item): [string, string][] => [
  ['stem', it.question],
  ...it.options.map((o, i) => [`option ${i + 1}`, o] as [string, string]),
  ['key', it.answer],
];

export function checkItem(
  src: Item, tgt: Item, matches: TermMatch[], allowedLatin: Set<string>, version: number, band: Band | null,
): { findings: Finding[]; glossary: GlossaryReport } {
  const f: Finding[] = [];
  if (src.options.length !== tgt.options.length) {
    f.push({ test: 'E1', field: 'options', problem: `English has ${src.options.length} options, the translation has ${tgt.options.length}. Give exactly one translated option per English option, in the same order.` });
  }
  if (blanks(src.question) !== blanks(tgt.question)) {
    f.push({ test: 'E1', field: 'stem', problem: `English stem has ${blanks(src.question)} blank marker(s) (___ or #), the translation has ${blanks(tgt.question)}. Keep each blank marker as written.` });
  }
  if (parts(src.answer) !== parts(tgt.answer)) {
    f.push({ test: 'E1', field: 'key', problem: `The English key has ${parts(src.answer)} part(s) separated by "$"; the translation has ${parts(tgt.answer)}. Keep the "$" separators.` });
  }
  const sf = fieldsOf(src), tf = fieldsOf(tgt);
  for (let i = 0; i < Math.min(sf.length, tf.length); i++) {
    const [name, s] = sf[i], t = tf[i][1];
    if (!sameList(images(s), images(t))) {
      f.push({ test: 'E1', field: name, problem: `Image reference changed. Copy exactly: ${images(s).join(' ') || '(none)'}` });
    }
    const ns = numbers(s), nt = numbers(t);
    if (!sameList(ns, nt)) {
      f.push({ test: 'E7', field: name, problem: `Numbers differ. English has ${ns.join(', ') || 'none'}; translation has ${nt.join(', ') || 'none'}. Copy every number exactly.` });
    }
  }
  // E3: the key must still be the option it was in English.
  const k = src.options.findIndex(o => norm(o) === norm(src.answer));
  if (k >= 0 && tgt.options[k] !== undefined && norm(tgt.options[k]) !== norm(tgt.answer)) {
    f.push({ test: 'E3', field: 'key', problem: `In English the key is option ${k + 1}. The key must be exactly the translated option ${k + 1}: "${tgt.options[k]}".` });
  }
  // "$" separates answer parts here; checkOutput would read a pair of them as inline maths.
  const glossary = checkOutput(tf.map(([, t]) => stripImages(t).replace(/\$/g, ' ')).join('\n'), matches, allowedLatin, version, band);
  f.push(...termFindings(glossary));
  return { findings: f, glossary };
}

export function checkText(
  src: string, tgt: string, matches: TermMatch[], allowedLatin: Set<string>, version: number, band: Band | null,
): { findings: Finding[]; glossary: GlossaryReport } {
  const f: Finding[] = [];
  const ns = numbers(src.replace(MATH_RE, ' ')).concat(numbers((src.match(MATH_RE) || []).join(' ')));
  const nt = numbers(tgt.replace(MATH_RE, ' ')).concat(numbers((tgt.match(MATH_RE) || []).join(' ')));
  ns.sort(); nt.sort();
  if (!sameList(ns, nt)) {
    f.push({ test: 'E7', field: 'text', problem: `Numbers differ. English has ${ns.join(', ') || 'none'}; translation has ${nt.join(', ') || 'none'}. Copy every number exactly.` });
  }
  const glossary = checkOutput(stripImages(tgt), matches, allowedLatin, version, band);
  f.push(...termFindings(glossary));
  return { findings: f, glossary };
}

function termFindings(g: GlossaryReport): Finding[] {
  const out: Finding[] = [];
  for (const t of g.terms) {
    if (t.found) continue;
    const en = `"${t.en}"${t.sense ? ` (${t.sense})` : ''}`;
    out.push({
      test: 'E6', field: 'any',
      problem: t.status === 'approved'
        ? `${en} must be rendered as "${t.target}" (inflected as needed) wherever the source uses it in that sense; leave it if the source means something else.`
        : `The glossary gives "${t.target}" for ${en}. Use it (inflected as needed) unless that sense plainly does not fit here.`,
    });
  }
  if (g.latinNotAllowed.length) {
    out.push({ test: 'E8', field: 'any', problem: `English left in Latin script: ${g.latinNotAllowed.join(', ')}. Write these in the target script (or drop an English gloss in brackets).` });
  }
  return out;
}
