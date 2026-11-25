import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePluginTranslate } from '../server/lib/pluginTranslate.js';

export const config = { maxDuration: 300 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { status, json } = await handlePluginTranslate(req.body);
  return res.status(status).json(json);
}
