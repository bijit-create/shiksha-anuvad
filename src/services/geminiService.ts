import { TranslationRequest, TranslationResponse, ContentAnalysis } from "../types";
import { getStoredToken } from "./auth";

interface RequestOptions {
  signal?: AbortSignal;
}

async function postJSON<T>(url: string, body: unknown, opts: RequestOptions = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['x-access-token'] = token;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (response.status === 401) {
    throw new Error('Unauthorized — the access token is missing or invalid.');
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
