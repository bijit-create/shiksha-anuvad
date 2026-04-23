import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getModel } from '../server/lib/gemini.js';
import { getExpectedToken, ACCESS_TOKEN_HEADER } from '../server/lib/auth.js';

export const config = { maxDuration: 10 };

export default function handler(req: VercelRequest, res: VercelResponse) {
  const expected = getExpectedToken();
  const authRequired = expected !== null;

  const raw = req.headers[ACCESS_TOKEN_HEADER];
  const provided = (Array.isArray(raw) ? raw[0] : raw || '').toString().trim();
  const authenticated = !authRequired || provided === expected;

  res.status(200).json({ ok: true, model: getModel(), authRequired, authenticated });
}
