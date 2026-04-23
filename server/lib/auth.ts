export const ACCESS_TOKEN_HEADER = 'x-access-token';

export function getExpectedToken(): string | null {
  const t = process.env.APP_ACCESS_TOKEN;
  return t && t.trim() ? t.trim() : null;
}

export function isAuthRequired(): boolean {
  return getExpectedToken() !== null;
}

type ReqLike = { headers: Record<string, any> };
type ResLike = {
  status: (code: number) => ResLike;
  json: (body: any) => any;
};

/**
 * Returns true if the request is allowed to proceed.
 * If auth is required and the token is missing/wrong, sends 401 and returns false.
 */
export function checkAccess(req: ReqLike, res: ResLike): boolean {
  const expected = getExpectedToken();
  if (!expected) return true;

  const raw = req.headers[ACCESS_TOKEN_HEADER];
  const provided = (Array.isArray(raw) ? raw[0] : raw || '').toString().trim();

  if (provided !== expected) {
    res.status(401).json({ error: 'Unauthorized. Provide a valid access token.' });
    return false;
  }
  return true;
}
