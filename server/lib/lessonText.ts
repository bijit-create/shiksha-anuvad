import { callGemini, authoritiesBlock, GeminiUsage } from './gemini.js';
import { translationRules } from './rules.js';
import { checkText, Finding } from './checks.js';
import {
  LanguageGlossary, GlossaryReport, TermMatch, getGlossaryForScript,
  gradeNumber, bandOf, r1Tokens, matchTerms, buildGlossaryBlock,
} from './glossary.js';

// Lesson text for the textbook-lesson-builder plugin: a batch of short strings (screen titles,
// instructions, feedback, button labels), each shown on screen and read aloud. One call per batch,
// so the model sees the strings together and words them consistently. Then the same code checks as
// the translator (numbers, glossary terms, English left in), plus placeholders and tags, one targeted
// repair pass, and a re-check. The report says which glossary terms were applied and found.

export interface LessonTextRequest {
  targetLanguage: string;
  grade?: string;
  subject?: string;
  context?: string;              // what the lesson is and who it is for, for the model only
  model?: string;                // one of pluginModels(); default PLUGIN_TRANSLATE_MODEL
  strings: Record<string, string>;
}

export interface LessonFinding extends Finding {
  key: string;
}

export interface LessonTextResult {
  language: string;
  glossaryVersion: number | null;
  strings: Record<string, string>;
  findings: LessonFinding[];       // left after the repair pass
  firstFindings: LessonFinding[];  // on the first draft
  repaired: boolean;
  glossary: GlossaryReport | null; // every glossary term matched in this batch, and whether the translation used it
  usage: GeminiUsage[];
}

// The model for plugin translations. gemini-4-hydrogen was chosen on 25 Nov 2026 after a blind T-QSI comparison
// of ten models in six languages (Hindi, Telugu, Odia, Punjabi, Marathi, Tamil): best average (98.9), no weak
// language, about 60% of 3.1 Pro's cost. PLUGIN_TRANSLATE_MODEL overrides it; Shiksha Anuvad's own site still
// uses GEMINI_MODEL. PLUGIN_TRANSLATE_MODELS (comma list) replaces the models a request may name; a named model
// is used as is, with no fallback, so comparisons compare that model.
export const PLUGIN_MODEL = 'gemini-4-hydrogen';
const DEFAULT_MODELS = [PLUGIN_MODEL, 'gemini-3.1-pro-preview', 'gemini-4-neon', 'gemini-4-argon', 'gemini-4-carbon',
  'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];
export function pluginModels(): string[] {
  const env = (process.env.PLUGIN_TRANSLATE_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
  return env.length ? env : DEFAULT_MODELS;
}
export function pluginDefaultModel(): string {
  return (process.env.PLUGIN_TRANSLATE_MODEL || '').trim() || PLUGIN_MODEL;
}

export const MAX_STRINGS = 120;
export const MAX_CHARS = 24_000;

const PLACEHOLDER = /\{[A-Za-z_][A-Za-z0-9_]*\}/g;
const TAG = /<\/?[a-zA-Z][^>]*>/g;
const list = (s: string, re: RegExp) => (s.match(re) || []).map(x => x.replace(/\s+/g, ' ')).sort();

// The Indic block each target language is written in. A letter from another Indic block inside the
// translation (Bengali letters in Odia words, seen in a model comparison) displays as the wrong script.
const SCRIPT: Record<string, [number, number]> = {
  Hindi: [0x0900, 0x097F], Marathi: [0x0900, 0x097F], Sanskrit: [0x0900, 0x097F],
  Bengali: [0x0980, 0x09FF], Assamese: [0x0980, 0x09FF], Punjabi: [0x0A00, 0x0A7F], Gujarati: [0x0A80, 0x0AFF],
  Odia: [0x0B00, 0x0B7F], Tamil: [0x0B80, 0x0BFF], Telugu: [0x0C00, 0x0C7F], Kannada: [0x0C80, 0x0CFF],
  Malayalam: [0x0D00, 0x0D7F],
};
/** Letters from another Indic script (U+0900–U+0DFF outside the target's block). Danda । ॥ are shared. */
export function foreignLetters(target: string, text: string): string[] {
  const own = SCRIPT[target];
  if (!own) return [];
  const bad = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x0900 && cp <= 0x0DFF && (cp < own[0] || cp > own[1]) && cp !== 0x0964 && cp !== 0x0965) bad.add(ch);
  }
  return [...bad];
}
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------- glossary for callers without a user session ----------

const CACHE_MS = 10 * 60_000;
const _cache = new Map<string, { g: LanguageGlossary; at: number }>();

/** The glossary through the loader-token export (GLOSSARY_LOADER_TOKEN), cached. Null if unavailable. */
export async function pluginGlossary(language: string): Promise<LanguageGlossary | null> {
  const token = (process.env.GLOSSARY_LOADER_TOKEN || '').trim();
  if (!token) return null;
  const hit = _cache.get(language);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.g;
  try {
    const g = await getGlossaryForScript(token, language);
    _cache.set(language, { g, at: Date.now() });
    return g;
  } catch (err: any) {
    console.warn(`[lesson-text] glossary for ${language} unavailable: ${err?.message || err}`);
    return hit?.g || null;
  }
}

// ---------- prompt ----------

function systemFor(target: string, grade: string | undefined, glossaryBlock: string): string {
  return `You translate the text of an interactive school lesson from English into ${target}.
The children are in Indian government schools${grade ? `, ${grade}` : ''}. Every string is shown on screen AND read aloud by a voice,
so it must sound natural when spoken to a child. Write the way the NCERT and state SCERT ${target}-medium textbooks write.
Authorities for ${target} terms:
${authoritiesBlock(target)}

${translationRules(target, { item: false })}

LESSON TEXT
- Re-compose each sentence in ${target}'s own word order. Do not mirror the English sentence shape.
- Full, natural sentences a teacher would say to a child. Instructions name a real action (tap, drag, move) with a literal verb.
- Address the child the same way in every string (the friendly form a teacher uses in class).
- The same English word or idea gets the same ${target} words everywhere in the batch.
- Short labels (button names, single words) stay short.
- Copy every placeholder in curly braces, such as {who} or {d}, exactly as written; it is filled in later. Keep the sentence
  grammatical around it.
- Copy any HTML tag, such as <b> or </b>, exactly, around the matching words.
- Numbers stay as digits, exactly as written (the lesson changes digit style itself).

OUTPUT
Return JSON only: {"strings": {"<key>": "<${target} text>", ...}} with exactly the same keys as the input, each once.${glossaryBlock ? '\n\n' + glossaryBlock : ''}`;
}

function describe(req: LessonTextRequest): string {
  const lines = [];
  if (req.grade) lines.push(`Grade: ${req.grade}`);
  if (req.subject) lines.push(`Subject: ${req.subject}`);
  if (req.context) lines.push(`About the lesson: ${req.context.slice(0, 2000)}`);
  return lines.join('\n');
}

// ---------- checks ----------

type TermUse = GlossaryReport['terms'][number];

interface KeyContext {
  matches: TermMatch[];
}

export function checkAll(
  src: Record<string, string>, tgt: Record<string, string>, ctx: Record<string, KeyContext>,
  allowed: Set<string>, version: number, band: ReturnType<typeof bandOf>, haveGlossary: boolean,
  target = '',
): { findings: LessonFinding[]; glossary: GlossaryReport | null } {
  const findings: LessonFinding[] = [];
  const terms = new Map<string, TermUse>();
  const latin = new Set<string>();
  for (const key of Object.keys(src)) {
    const s = src[key], t = tgt[key];
    if (typeof t !== 'string' || !t.trim()) {
      findings.push({ key, test: 'E1', field: 'text', problem: `The string "${key}" is missing. Translate it.` });
      continue;
    }
    if (!same(list(s, PLACEHOLDER), list(t, PLACEHOLDER))) {
      findings.push({ key, test: 'E1', field: 'text', problem: `Placeholders changed. English has ${list(s, PLACEHOLDER).join(' ') || 'none'}; translation has ${list(t, PLACEHOLDER).join(' ') || 'none'}. Copy each one exactly.` });
    }
    if (!same(list(s, TAG), list(t, TAG))) {
      findings.push({ key, test: 'E1', field: 'text', problem: `HTML tags changed. English has ${list(s, TAG).join(' ') || 'none'}. Copy them exactly.` });
    }
    const foreign = foreignLetters(target, t);
    if (foreign.length) {
      findings.push({ key, test: 'E2', field: 'text', problem: `Letters from another script: ${foreign.join(' ')}. Write every word in ${target} script only.` });
    }
    // Placeholders are not numbers and not English words left in; hide them from the shared checks.
    const c = checkText(s.replace(PLACEHOLDER, ' '), t.replace(PLACEHOLDER, ' ').replace(TAG, ' '), ctx[key].matches, allowed, version, band);
    findings.push(...c.findings.map(f => ({ ...f, key })));
    for (const u of c.glossary.terms) {
      const id = `${u.en}|${u.sense}`;
      const prev = terms.get(id);
      terms.set(id, prev ? { ...prev, found: prev.found && u.found, matchedForm: prev.matchedForm || u.matchedForm } : u);
    }
    c.glossary.latinNotAllowed.forEach(w => latin.add(w));
  }
  for (const key of Object.keys(tgt)) {
    if (!(key in src)) findings.push({ key, test: 'E1', field: 'text', problem: `"${key}" is not one of the input keys. Remove it.` });
  }
  return {
    findings,
    glossary: haveGlossary ? { version, band, terms: [...terms.values()], latinNotAllowed: [...latin] } : null,
  };
}

const SEVERITY: Record<string, number> = { E1: 10, E2: 10, E3: 10, E7: 10, E8: 3, E6: 2 };
const weight = (f: Finding[]) => f.reduce((n, x) => n + (SEVERITY[x.test] ?? 1), 0);

function asStrings(j: any): Record<string, string> {
  const o = j?.strings && typeof j.strings === 'object' ? j.strings : {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (v != null) out[k] = String(v);
  return out;
}

/** Throws an Error with .status = 400 when the request is not usable. */
export function validate(body: any): LessonTextRequest {
  const bad = (m: string) => Object.assign(new Error(m), { status: 400 });
  const targetLanguage = String(body?.targetLanguage || '').trim();
  if (!targetLanguage) throw bad('targetLanguage is required.');
  const strings = body?.strings;
  if (!strings || typeof strings !== 'object' || Array.isArray(strings)) throw bad('strings must be an object of key: English text.');
  const entries = Object.entries(strings).filter(([, v]) => typeof v === 'string' && (v as string).trim());
  if (!entries.length) throw bad('strings has nothing to translate.');
  if (entries.length > MAX_STRINGS) throw bad(`Send at most ${MAX_STRINGS} strings per request.`);
  const chars = entries.reduce((n, [, v]) => n + (v as string).length, 0);
  if (chars > MAX_CHARS) throw bad(`Send at most ${MAX_CHARS} characters per request (this one has ${chars}).`);
  const model = body.model ? String(body.model).trim() : undefined;
  if (model && !pluginModels().includes(model)) throw bad(`model must be one of: ${pluginModels().join(', ')}.`);
  return {
    targetLanguage,
    model,
    grade: body.grade ? String(body.grade) : undefined,
    subject: body.subject ? String(body.subject) : undefined,
    context: body.context ? String(body.context) : undefined,
    strings: Object.fromEntries(entries) as Record<string, string>,
  };
}

export async function translateLessonText(req: LessonTextRequest, g: LanguageGlossary | null): Promise<LessonTextResult> {
  const target = req.targetLanguage;
  const grade = gradeNumber(req.grade);
  const band = bandOf(grade);
  const allowed = g ? r1Tokens(g, band) : new Set<string>();
  const ctx: Record<string, KeyContext> = {};
  for (const [k, s] of Object.entries(req.strings)) {
    ctx[k] = { matches: g ? matchTerms(s.replace(PLACEHOLDER, ' '), g, grade, req.subject, allowed) : [] };
  }
  // One glossary block for the batch: every term matched in any string, once.
  const seen = new Set<string>();
  const all = Object.values(ctx).flatMap(c => c.matches).filter(m => {
    if (seen.has(m.en)) return false;
    seen.add(m.en);
    return true;
  });
  const glossaryBlock = g ? buildGlossaryBlock(target, g, all, band, allowed) : '';
  const version = g ? g.version : -1;
  const system = systemFor(target, req.grade, glossaryBlock);
  const english = JSON.stringify({ strings: req.strings }, null, 1);
  const usage: GeminiUsage[] = [];
  const check = (t: Record<string, string>) => checkAll(req.strings, t, ctx, allowed, version, band, !!g, target);

  // A chosen model is used as is (no fallback), so a comparison really compares that model.
  const model = req.model || pluginDefaultModel();
  const ask = (prompt: string) => callGemini(system, prompt, 6, model, !req.model);
  const first = await ask(`${describe(req)}\n\nEnglish strings:\n${english}`);
  usage.push(first.usage);
  const draft = asStrings(first.json);
  const c1 = check(draft);
  const done = (strings: Record<string, string>, c: typeof c1, repaired: boolean): LessonTextResult => ({
    language: target, glossaryVersion: g ? g.version : null,
    strings: Object.fromEntries(Object.keys(req.strings).map(k => [k, strings[k] ?? ''])),
    findings: c.findings, firstFindings: c1.findings, repaired, glossary: c.glossary, usage,
  });
  if (!c1.findings.length) return done(draft, c1, false);

  const problems = c1.findings.map(f => `- [${f.test}, ${f.key}] ${f.problem}`).join('\n');
  try {
    const second = await ask(`${describe(req)}

English strings:
${english}

Your ${target} translation:
${JSON.stringify({ strings: draft }, null, 1)}

Automatic checks found these problems. Fix each one and change nothing else:
${problems}

Return all the strings again, corrected, in the same JSON form.`);
    usage.push(second.usage);
    const fixed = asStrings(second.json);
    const c2 = check(fixed);
    if (weight(c2.findings) <= weight(c1.findings)) return done(fixed, c2, true);
  } catch (err: any) {
    console.warn(`[lesson-text] repair failed: ${err?.message || err}`);
  }
  return done(draft, c1, false);
}
