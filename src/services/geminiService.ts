import { TranslationRequest, TranslationResponse, ContentAnalysis } from "../types";

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export async function translateContent(request: TranslationRequest): Promise<TranslationResponse> {
  return postJSON<TranslationResponse>('/api/translate', request);
}

export async function analyzeContent(request: TranslationRequest): Promise<ContentAnalysis> {
  return postJSON<ContentAnalysis>('/api/analyze', request);
}
