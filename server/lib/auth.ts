import { anonClient, isSupabaseConfigured } from './supabase.js';

// Sign-in is Supabase Auth. Only accounts on ALLOWED_EMAIL_DOMAIN (default convegenius.ai) may use the API.
// The database also refuses to create accounts on any other domain.

export function allowedDomain(): string {
  return (process.env.ALLOWED_EMAIL_DOMAIN || 'convegenius.ai').trim().toLowerCase();
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith('@' + allowedDomain());
}

export interface AuthUser {
  email: string;
  token: string;
}

type ReqLike = { headers: Record<string, any> };
type ResLike = {
  status: (code: number) => ResLike;
  json: (body: any) => any;
};

// Validated tokens, so a batch of requests does not call the Auth server for every cell.
const TOKEN_CACHE_MS = 5 * 60_000;
const _tokenCache = new Map<string, { email: string; until: number }>();

export function bearerToken(req: ReqLike): string {
  const raw = req.headers['authorization'] || req.headers['Authorization'] || '';
  const value = (Array.isArray(raw) ? raw[0] : raw).toString();
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

export async function verifyToken(token: string): Promise<string | null> {
  if (!token) return null;
  const hit = _tokenCache.get(token);
  if (hit && hit.until > Date.now()) return hit.email;
  const { data, error } = await anonClient().auth.getUser(token);
  const email = data?.user?.email || null;
  if (error || !isAllowedEmail(email)) return null;
  _tokenCache.set(token, { email: email!, until: Date.now() + TOKEN_CACHE_MS });
  if (_tokenCache.size > 2000) {
    for (const [k, v] of _tokenCache) if (v.until <= Date.now()) _tokenCache.delete(k);
  }
  return email;
}

/**
 * Returns the signed-in user, or sends 401/500 and returns null.
 */
export async function authenticate(req: ReqLike, res: ResLike): Promise<AuthUser | null> {
  if (!isSupabaseConfigured()) {
    res.status(500).json({ error: 'Server misconfigured: SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not set.' });
    return null;
  }
  const token = bearerToken(req);
  const email = await verifyToken(token).catch(() => null);
  if (!email) {
    res.status(401).json({ error: `Sign in with your ${allowedDomain()} account.` });
    return null;
  }
  return { email, token };
}
