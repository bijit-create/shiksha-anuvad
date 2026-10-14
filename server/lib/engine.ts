import { callGemini, authoritiesBlock, GeminiUsage } from './gemini.js';
import { translationRules } from './rules.js';
import { Item, Finding, checkItem, stripImages } from './checks.js';
import {
  LanguageGlossary, GlossaryReport, TermMatch, Band,
  gradeNumber, bandOf, r1Tokens, matchTerms, buildGlossaryBlock,
} from './glossary.js';

// One assessment item per call: stem, options and key go to the model together as JSON, so the key,
// the blanks and the options stay consistent. Then code checks, one targeted repair pass, and a re-check.

export interface ItemRequest {
  item: Item;
  targetLanguage: string;
  grade?: string;
  subject?: string;
  topic?: string;      // context for the model only
  format?: string;     // mcq, fill, …
}

export interface ItemResult {
  item: Item;
  findings: Finding[];        // left after the repair pass
  firstFindings: Finding[];   // on the first draft
  repaired: boolean;          // the repaired draft was kept
  glossary: GlossaryReport | null;
  usage: GeminiUsage[];
}

const IMAGE_ONLY = /^\s*(\[image\]\s*)?\/uploads\//i;
const LABEL = /^\s*\(?[A-Z]\)?\s*$/;
const norm = (s: string) => (s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/** Fields with nothing to translate (image references, numbers, option labels such as "B" or "(D)"). */
function isFixed(s: string): boolean {
  return IMAGE_ONLY.test(s) || LABEL.test(s) || !/[A-Za-z]/.test(s);
}

/**
 * Overwrite what code can decide: fixed options are copied, and each key part that names an option
 * becomes exactly that translated option, so the key cannot drift (E3).
 */
function settle(src: Item, tgt: Item): Item {
  const options = src.options.map((o, i) => (isFixed(o) ? o : (tgt.options[i] ?? '')));
  const tParts = (tgt.answer || '').split('$');
  const answer = src.answer.split('$').map((p, i) => {
    const k = src.options.findIndex(o => norm(o) === norm(p));
    if (k >= 0) return options[k];
    if (isFixed(p)) return p;
    return (tParts[i] ?? '').trim();
  }).join('$');
  return { question: tgt.question ?? '', options, answer };
}

function asItem(j: any): Item {
  return {
    question: typeof j?.question === 'string' ? j.question : '',
    options: Array.isArray(j?.options) ? j.options.map((o: any) => (o == null ? '' : String(o))) : [],
    answer: j?.answer == null ? '' : String(j.answer),
  };
}

const SEVERITY: Record<string, number> = { E1: 10, E3: 10, E7: 10, E8: 3, E6: 2 };
const weight = (f: Finding[]) => f.reduce((n, x) => n + (SEVERITY[x.test] ?? 1), 0);

function systemFor(target: string, glossaryBlock: string, nOptions: number): string {
  return `You translate school assessment items from English into ${target} for students in Indian government schools.
Write the way the NCERT and state SCERT ${target}-medium textbooks write. Authorities for ${target} terms:
${authoritiesBlock(target)}

${translationRules(target, { item: true })}

OUTPUT
Return JSON only, in this form:
{"question": "<stem in ${target}>", "options": [<exactly ${nOptions} strings, one per English option, same order>], "answer": "<key in ${target}>"}
- Copy LaTeX such as \\( … \\) and symbols such as cm², ∠, ° unchanged inside the ${target} text.
- An option or key that is only a number, a letter label or an image reference is copied as it is.${glossaryBlock ? '\n\n' + glossaryBlock : ''}`;
}

function describe(req: ItemRequest): string {
  const lines = [];
  if (req.grade) lines.push(`Grade: ${req.grade}`);
  if (req.subject) lines.push(`Subject: ${req.subject}`);
  if (req.topic) lines.push(`Topic: ${req.topic}`);
  if (req.format) lines.push(`Format: ${req.format}`);
  return lines.join('\n');
}

export interface ItemContext {
  matches: TermMatch[];
  allowed: Set<string>;
  band: Band | null;
  glossaryBlock: string;
  version: number;
}

/** Glossary terms and R1 tokens for one item. Exported so callers can show what will be applied. */
export function itemContext(req: ItemRequest, g: LanguageGlossary | null): ItemContext {
  const grade = gradeNumber(req.grade);
  const band = bandOf(grade);
  if (!g) return { matches: [], allowed: new Set(), band, glossaryBlock: '', version: -1 };
  const allowed = r1Tokens(g, band);
  const text = [req.item.question, ...req.item.options, req.item.answer].map(stripImages).join('\n');
  const matches = matchTerms(text, g, grade, req.subject, allowed);
  return { matches, allowed, band, glossaryBlock: buildGlossaryBlock(req.targetLanguage, g, matches, band, allowed), version: g.version };
}

export async function translateItem(req: ItemRequest, g: LanguageGlossary | null): Promise<ItemResult> {
  const target = req.targetLanguage.trim();
  const src = req.item;
  const ctx = itemContext(req, g);
  const system = systemFor(target, ctx.glossaryBlock, src.options.length);
  const english = JSON.stringify(src, null, 1);
  const usage: GeminiUsage[] = [];
  const check = (t: Item) => checkItem(src, t, ctx.matches, ctx.allowed, ctx.version, ctx.band);

  const first = await callGemini(system, `${describe(req)}\n\nEnglish item:\n${english}`);
  usage.push(first.usage);
  const draft = settle(src, asItem(first.json));
  const c1 = check(draft);
  if (!c1.findings.length) {
    return { item: draft, findings: [], firstFindings: [], repaired: false, glossary: g ? c1.glossary : null, usage };
  }

  const problems = c1.findings.map(f => `- [${f.test}, ${f.field}] ${f.problem}`).join('\n');
  const repairPrompt = `${describe(req)}

English item:
${english}

Your ${target} translation:
${JSON.stringify(draft, null, 1)}

Automatic checks found these problems. Fix each one and change nothing else:
${problems}

Return the whole corrected item in the same JSON form.`;
  try {
    const second = await callGemini(system, repairPrompt);
    usage.push(second.usage);
    const fixed = settle(src, asItem(second.json));
    const c2 = check(fixed);
    if (weight(c2.findings) <= weight(c1.findings)) {
      return { item: fixed, findings: c2.findings, firstFindings: c1.findings, repaired: true, glossary: g ? c2.glossary : null, usage };
    }
  } catch (err: any) {
    console.warn(`[engine] repair failed: ${err?.message || err}`);
  }
  return { item: draft, findings: c1.findings, firstFindings: c1.findings, repaired: false, glossary: g ? c1.glossary : null, usage };
}
