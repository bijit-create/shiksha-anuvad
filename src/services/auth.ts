const TOKEN_KEY = 'shiksha-anuvad.access-token';

export function getStoredToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function storeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // localStorage unavailable (private mode, etc.) — fall through silently
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export interface AuthStatus {
  authRequired: boolean;
  authenticated: boolean;
  model?: string;
}

export async function fetchAuthStatus(token: string): Promise<AuthStatus> {
  const response = await fetch('/api/health', {
    headers: token ? { 'x-access-token': token } : {},
  });
  if (!response.ok) {
    throw new Error(`Health check failed (${response.status})`);
  }
  const data = await response.json();
  return {
    authRequired: !!data.authRequired,
    authenticated: !!data.authenticated,
    model: data.model,
  };
}
