import { TranslationRequest, TranslationResponse, ContentAnalysis, GlossaryInfo, GlossaryLookupRow } from "../types";
import { getAccessToken, signOut } from "./auth";

interface RequestOptions {
  signal?: AbortSignal;
}

async function postJSON<T>(url: string, body: unknown, opts: RequestOptions = {}): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (response.status === 401) {
    await signOut();
    throw new Error('Your session has expired. Please sign in again.');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export async function translateContent(
  request: TranslationRequest,
  opts: RequestOptions = {},
): Promise<TranslationResponse> {
  return postJSON<TranslationResponse>('/api/translate', request, opts);
}

export async function analyzeContent(
  request: TranslationRequest,
  opts: RequestOptions = {},
): Promise<ContentAnalysis> {
  return postJSON<ContentAnalysis>('/api/analyze', request, opts);
}

async function getJSON<T>(url: string): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (response.status === 401) {
    await signOut();
    throw new Error('Your session has expired. Please sign in again.');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function glossaryInfo(language: string): Promise<GlossaryInfo> {
  return getJSON<GlossaryInfo>(`/api/glossary?language=${encodeURIComponent(language)}`);
}

export async function lookupGlossary(language: string, q: string): Promise<GlossaryLookupRow[]> {
  const r = await getJSON<{ terms: GlossaryLookupRow[] }>(`/api/glossary?language=${encodeURIComponent(language)}&q=${encodeURIComponent(q)}`);
  return r.terms;
}
