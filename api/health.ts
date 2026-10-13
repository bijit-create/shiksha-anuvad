import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getModel, getFastModel, getKeyCount } from '../server/lib/gemini.js';
import { allowedDomain } from '../server/lib/auth.js';
import { isSupabaseConfigured } from '../server/lib/supabase.js';

export const config = { maxDuration: 10 };

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    ok: true,
    model: getModel(),
    fastModel: getFastModel(),
    apiKeyCount: getKeyCount(),
    auth: 'supabase',
    allowedDomain: allowedDomain(),
    supabaseConfigured: isSupabaseConfigured(),
  });
}
