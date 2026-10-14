import { AuthUser } from './auth.js';
import { userClient } from './supabase.js';

// What the glossary panel shows: version, last update, and a term lookup.
// Reads the database as the signed-in user, so it shows what translation would use right now.

export interface GlossaryInfo {
  version: number;
  updatedAt: string | null;
  language: string;
}

export interface LookupRow {
  en: string;
  sense: string;
  kind: string;
  gradeMin: number | null;
  gradeMax: number | null;
  target: string;
  variants: string[];
  status: 'approved' | 'candidate';
}

export async function glossaryInfo(user: AuthUser, language: string): Promise<GlossaryInfo> {
  const meta = await userClient(user.token).from('glossary_meta').select('version, updated_at').single();
  if (meta.error) throw meta.error;
  return {
    version: Number(meta.data?.version ?? -1),
    updatedAt: meta.data?.updated_at ?? null,
    language,
  };
}

/** English text matches the English term; text in another script matches the translation and its variants. */
export async function lookupTerm(user: AuthUser, language: string, q: string): Promise<LookupRow[]> {
  const query = q.trim().replace(/[%_,()]/g, ' ').trim();
  if (query.length < 2) return [];
  const english = /^[\x00-\x7F]+$/.test(query);
  let req = userClient(user.token)
    .from('glossary_translation')
    .select('target, variants, status, term:glossary_term!inner(en, sense, kind, grade_min, grade_max)')
    .eq('language', language)
    .in('status', ['approved', 'candidate'])
    .limit(40);
  req = english ? req.ilike('term.en', `%${query}%`) : req.ilike('target', `%${query}%`);
  const { data, error } = await req;
  if (error) throw error;

  const rows: LookupRow[] = (data || []).map((r: any) => ({
    en: r.term.en, sense: r.term.sense || '', kind: r.term.kind,
    gradeMin: r.term.grade_min, gradeMax: r.term.grade_max,
    target: r.target, variants: r.variants || [], status: r.status,
  }));
  // Exact matches first, then shorter terms, then approved before candidate.
  const key = query.toLowerCase();
  const exact = (r: LookupRow) => (english ? r.en.toLowerCase() === key : r.target === query) ? 0 : 1;
  return rows.sort((a, b) =>
    exact(a) - exact(b)
    || (english ? a.en.length - b.en.length : a.target.length - b.target.length)
    || (a.status === b.status ? 0 : a.status === 'approved' ? -1 : 1),
  ).slice(0, 25);
}
