import type { SupabaseClient } from '@supabase/supabase-js';
import { anonClient, userClient } from './supabase.js';

// Glossary-locked translation.
// The glossary (R2) and conventions (R1 Latin tokens, R3 house style) live in Supabase. Each server instance keeps
// one in-memory index per language and re-checks glossary_meta.version at most once a minute, so a translation
// request normally costs no database round trip. Matching is lexical (normalised English n-grams), which is exact
// for terminology; senses are shown to the model when a term has more than one.

export type Band = '1-5' | '6-10' | '11-12';
export type Status = 'approved' | 'candidate';

export interface GlossaryEntry {
  termId: number;
  en: string;
  sense: string;
  subject: string;
  gradeMin: number;
  gradeMax: number;
  target: string;
  variants: string[];
  status: Status;
}

export interface Convention {
  list: 'R1' | 'R3';
  kind: string;
  gradeBand: string;
  token: string | null;
  standard: string | null;
  rule: string | null;
  status: Status;
}

export interface LanguageGlossary {
  language: string;
  version: number;
  checkedAt: number;
  index: Map<string, GlossaryEntry[]>;
  maxWords: number;
  conventions: Convention[];
  size: number;
}

export interface TermMatch {
  en: string;
  options: GlossaryEntry[];
}

export interface GlossaryReport {
  version: number;
  band: Band | null;
  terms: { en: string; sense: string; target: string; status: Status; found: boolean }[];
  latinNotAllowed: string[];
}

const CHECK_MS = 60_000;
const _cache = new Map<string, LanguageGlossary>();

function includeCandidates(): boolean {
  return (process.env.GLOSSARY_INCLUDE_CANDIDATES ?? 'true').trim().toLowerCase() !== 'false';
}

const nfc = (s: string) => (s || '').normalize('NFC');

// ---------- English normalisation (same rule as the glossary pipeline's en_key) ----------

export function normWord(w: string): string {
  w = w.toLowerCase().replace(/[’']s$/, '');
  return w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
}

function keyWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]+(?:['’][a-z]+)?/g) || []).map(normWord);
}

/** Match keys for one glossary row: "add / addition" gives "add" and "addition"; parentheses are dropped. */
function keysFor(enKey: string, en: string): string[] {
  const base = (enKey || en).replace(/\(.*?\)/g, ' ');
  return base
    .split('/')
    .map(part => keyWords(part).join(' '))
    .filter(Boolean);
}

/** Words of the source text, with maths removed so variables never match terms. */
function sourceWords(text: string): string[] {
  const noMath = text
    .replace(/\\\([\s\S]*?\\\)/g, ' ')
    .replace(/\\\[[\s\S]*?\\\]/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$]*\$/g, ' ');
  return keyWords(noMath);
}

// ---------- loading ----------

async function loadLanguage(client: SupabaseClient, language: string, version: number): Promise<LanguageGlossary> {
  const statuses: Status[] = includeCandidates() ? ['approved', 'candidate'] : ['approved'];

  // The API returns at most 1,000 rows per request, so read in pages.
  const PAGE = 1000;
  async function all(make: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>) {
    const out: any[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await make(from, from + PAGE - 1);
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < PAGE) return out;
    }
  }

  const [rows, conv] = await Promise.all([
    all((a, b) =>
      client
        .from('glossary_translation')
        // Only maths terms are locked; common words and instructions stay in the glossary for reference.
        .select('id, target, variants, status, term:glossary_term!inner(id, en, en_key, sense, subject, kind, grade_min, grade_max)')
        .eq('term.kind', 'term')
        .eq('language', language)
        .in('status', statuses)
        .order('id')
        .range(a, b),
    ),
    all((a, b) =>
      client
        .from('convention')
        .select('id, list, kind, grade_band, token, standard, rule, status')
        .eq('language', language)
        .in('status', statuses)
        .order('id')
        .range(a, b),
    ),
  ]);

  return buildGlossary(language, version, rows, conv);
}

/** In-memory index from glossary_translation rows (with their term) and convention rows. */
export function buildGlossary(language: string, version: number, rows: any[], conv: any[]): LanguageGlossary {
  const index = new Map<string, GlossaryEntry[]>();
  let maxWords = 1;
  for (const r of rows || []) {
    const t: any = Array.isArray((r as any).term) ? (r as any).term[0] : (r as any).term;
    if (!t) continue;
    const entry: GlossaryEntry = {
      termId: t.id,
      en: t.en,
      sense: t.sense || '',
      subject: t.subject || '',
      gradeMin: t.grade_min ?? 0,
      gradeMax: t.grade_max ?? 12,
      target: nfc((r as any).target),
      variants: ((r as any).variants || []).map(nfc),
      status: (r as any).status,
    };
    for (const k of keysFor(t.en_key, t.en)) {
      const list = index.get(k) || [];
      list.push(entry);
      index.set(k, list);
      maxWords = Math.max(maxWords, k.split(' ').length);
    }
  }

  const conventions: Convention[] = (conv || []).map((c: any) => ({
    list: c.list,
    kind: c.kind,
    gradeBand: c.grade_band,
    token: c.token,
    standard: c.standard,
    rule: c.rule,
    status: c.status,
  }));

  return { language, version, checkedAt: Date.now(), index, maxWords, conventions, size: (rows || []).length };
}

/** For scripts without a user session: the same glossary through the loader-token export RPC. */
export async function getGlossaryForScript(loaderToken: string, language: string): Promise<LanguageGlossary> {
  const { data, error } = await anonClient().rpc('export_glossary', { p_token: loaderToken, p_language: language });
  if (error) throw error;
  return buildGlossary(language, Number(data.version), data.rows || [], data.conventions || []);
}

/** The glossary for one language, refreshed when glossary_meta.version changes. Null if unavailable. */
export async function getGlossary(accessToken: string, language: string): Promise<LanguageGlossary | null> {
  const cached = _cache.get(language);
  if (cached && Date.now() - cached.checkedAt < CHECK_MS) return cached;
  const client = userClient(accessToken);
  try {
    const { data, error } = await client.from('glossary_meta').select('version').single();
    if (error) throw error;
    const version = Number(data?.version ?? -1);
    if (cached && cached.version === version) {
      cached.checkedAt = Date.now();
      return cached;
    }
    const fresh = await loadLanguage(client, language, version);
    _cache.set(language, fresh);
    return fresh;
  } catch (err: any) {
    console.warn(`[glossary] could not refresh ${language}: ${err?.message || err}`);
    return cached || null;
  }
}

// ---------- grade ----------

export function gradeNumber(grade?: string): number | null {
  if (!grade) return null;
  if (/^\s*kg\s*$/i.test(grade)) return 0;
  const m = grade.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

export function bandOf(g: number | null): Band | null {
  if (g === null) return null;
  if (g <= 5) return '1-5';
  if (g <= 10) return '6-10';
  return '11-12';
}

/** R1 tokens allowed in Latin script for this band. Unknown band: only rows for all grades. */
export function r1Tokens(g: LanguageGlossary, band: Band | null): Set<string> {
  const out = new Set<string>();
  for (const c of g.conventions) {
    if (c.list !== 'R1' || c.status !== 'approved' || !c.token) continue;
    if (c.gradeBand === 'all' || (band && c.gradeBand === band)) out.add(c.token.toLowerCase().replace(/\.+$/, ''));
  }
  return out;
}

// ---------- matching ----------

export function matchTerms(
  text: string,
  g: LanguageGlossary,
  grade: number | null,
  subject: string | undefined,
  skipKeys: Set<string>,
): TermMatch[] {
  const words = sourceWords(text);
  const used = new Array(words.length).fill(false);
  const found = new Map<string, TermMatch>();
  const order: { key: string; pos: number }[] = [];

  for (let n = Math.min(g.maxWords, words.length); n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      if (used.slice(i, i + n).some(Boolean)) continue;
      const key = words.slice(i, i + n).join(' ');
      if (skipKeys.has(key)) continue;
      let options = g.index.get(key);
      if (!options) continue;
      if (grade !== null) options = options.filter(o => grade >= o.gradeMin && grade <= o.gradeMax);
      if (subject) {
        const same = options.filter(o => o.subject.toLowerCase() === subject.toLowerCase());
        if (same.length) options = same;
      }
      if (!options.length) continue;
      for (let j = i; j < i + n; j++) used[j] = true;
      if (!found.has(key)) {
        const sorted = [...options].sort((a, b) => (a.status === b.status ? 0 : a.status === 'approved' ? -1 : 1));
        found.set(key, { en: sorted[0].en, options: dedupe(sorted) });
        order.push({ key, pos: i });
      }
    }
  }
  return order.sort((a, b) => a.pos - b.pos).map(o => found.get(o.key)!);
}

function dedupe(options: GlossaryEntry[]): GlossaryEntry[] {
  const seen = new Set<string>();
  return options.filter(o => {
    const k = `${o.sense}|${o.target}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------- prompt ----------

const label = (s: Status) => (s === 'approved' ? 'REQUIRED' : 'PREFERRED');

export function buildGlossaryBlock(
  target: string,
  g: LanguageGlossary,
  matches: TermMatch[],
  band: Band | null,
  allowedLatin: Set<string>,
): string {
  const lines: string[] = [];
  lines.push('============================================================');
  lines.push(`GLOSSARY AND CONVENTIONS — ConveGenius glossary v${g.version}. These override Phase 1 where they differ.`);
  lines.push('============================================================');

  if (matches.length) {
    lines.push(`A. TERMS IN THIS SOURCE. Use the given ${target} term for each. Inflect it as the grammar needs (plural, oblique case), but never replace it with another word.`);
    lines.push(`   REQUIRED = approved by Content Governance. PREFERRED = printed in the NCERT ${target} textbook, not yet reviewed: use it unless it plainly does not fit the sense.`);
    for (const m of matches) {
      // Options with the same sense are alternative forms printed in different chapters: show one line.
      const bySense = new Map<string, GlossaryEntry[]>();
      for (const o of m.options) bySense.set(o.sense, [...(bySense.get(o.sense) || []), o]);
      const line = (group: GlossaryEntry[]) => {
        const main = group[0];
        const also = [...new Set(group.slice(1).map(o => o.target).concat(main.variants))].filter(t => t !== main.target);
        return `${main.target} [${label(main.status)}]${also.length ? `; also printed: ${also.slice(0, 6).join(', ')}` : ''}`;
      };
      if (bySense.size === 1) {
        const [sense, group] = [...bySense.entries()][0];
        lines.push(`   - "${m.en}"${sense ? ` (${sense})` : ''} → ${line(group)}`);
      } else {
        lines.push(`   - "${m.en}" has more than one sense; use the one that fits:`);
        [...bySense.entries()].forEach(([sense, group], i) =>
          lines.push(`       (${i + 1}) ${sense || 'general'} → ${line(group)}`),
        );
      }
    }
  }

  const tokens = [...allowedLatin].filter(t => !/^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/.test(t));
  lines.push('B. UNITS AND ABBREVIATIONS' + (band ? ` (grade band ${band})` : '') + '.');
  if (tokens.length) {
    lines.push(`   Keep exactly these in Latin script: ${tokens.join(', ')}. Write every other unit, currency or abbreviation in ${target}.`);
  } else {
    lines.push(`   Write every unit, currency and abbreviation in ${target} (for example cm, kg, a.m., Rs, sq. m). Do not leave them in Latin script.`);
  }
  lines.push('   Keep roman-numeral list markers (i, ii, iii …) as they are.');

  const style = g.conventions.filter(c => c.list === 'R3' && c.rule && c.kind !== 'units' && c.kind !== 'layout');
  if (style.length) {
    lines.push(`C. HOUSE STYLE (${target}). REQUIRED rules are approved; PREFERRED rules come from the NCERT textbook.`);
    for (const c of style) {
      const ex = c.token && c.standard ? ` e.g. "${c.token}" → "${c.standard}"` : '';
      lines.push(`   - [${label(c.status)}] ${c.rule}${ex}`);
    }
  }
  return lines.join('\n');
}

// ---------- after translation ----------

export function checkOutput(
  translated: string,
  matches: TermMatch[],
  allowedLatin: Set<string>,
  version: number,
  band: Band | null,
): GlossaryReport {
  const text = nfc(translated || '');
  const terms = matches.map(m => {
    const hit = m.options.find(o => [o.target, ...o.variants].some(f => f && text.includes(f)));
    const o = hit || m.options[0];
    return { en: o.en, sense: o.sense, target: o.target, status: o.status, found: !!hit };
  });

  const prose = text
    .replace(/\\\([\s\S]*?\\\)/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$]*\$/g, ' ');
  const latin = new Set<string>();
  for (const w of prose.match(/[A-Za-z][A-Za-z.]*/g) || []) {
    const t = w.replace(/\.+$/, '');
    if (t.length <= 1 || t === t.toUpperCase()) continue; // single letters and labels (ABC)
    if (allowedLatin.has(t.toLowerCase())) continue;
    latin.add(t);
  }
  return { version, band, terms, latinNotAllowed: [...latin] };
}
