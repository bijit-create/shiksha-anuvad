import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getModel } from '../server/lib/gemini.js';

export const config = { maxDuration: 10 };

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({ ok: true, model: getModel() });
}
