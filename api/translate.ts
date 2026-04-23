import type { VercelRequest, VercelResponse } from '@vercel/node';
import { translate } from '../server/lib/gemini.js';
import { checkAccess } from '../server/lib/auth.js';

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!checkAccess(req, res)) return;

  try {
    const { content } = req.body || {};
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    const result = await translate(req.body);
    return res.status(200).json(result);
  } catch (err: any) {
    const message = err?.message || String(err);
    console.error('[translate]', message);
    if (message.includes('GEMINI_API_KEY')) {
      return res.status(500).json({ error: 'Server misconfigured: GEMINI_API_KEY not set on the deployment.' });
    }
    return res.status(500).json({ error: 'Failed to translate content. Please try again.' });
  }
}
