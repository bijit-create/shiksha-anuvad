import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate } from '../server/lib/auth.js';
import { glossaryInfo, lookupTerm } from '../server/lib/glossaryLookup.js';

export const config = { maxDuration: 15 };

// GET /api/glossary?language=Hindi            → version, last update, term counts
// GET /api/glossary?language=Hindi&q=altitude → matching terms
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await authenticate(req, res);
  if (!user) return;
  const language = String(req.query.language || 'Hindi');
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  try {
    return res.status(200).json(q ? { terms: await lookupTerm(user, language, q) } : await glossaryInfo(user, language));
  } catch (err: any) {
    console.error('[glossary]', err?.message || err);
    return res.status(500).json({ error: 'Could not read the glossary.' });
  }
}
