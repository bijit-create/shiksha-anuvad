import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { analyze, getModel, getKeyCount } from './lib/gemini.js';
import { authenticate, allowedDomain } from './lib/auth.js';
import { isSupabaseConfigured } from './lib/supabase.js';
import { translateForUser } from './lib/pipeline.js';
import { glossaryInfo, lookupTerm } from './lib/glossaryLookup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '8080', 10);

// Validate at least one Gemini API key is configured. Supports any of:
//   GEMINI_API_KEYS    (comma-separated)
//   GEMINI_API_KEY_1+  (numbered)
//   GEMINI_API_KEY     (single — legacy)
const hasAnyKey =
  !!process.env.GEMINI_API_KEYS?.trim() ||
  !!process.env.GEMINI_API_KEY_1?.trim() ||
  !!process.env.GEMINI_API_KEY?.trim();
if (!hasAnyKey) {
  console.error('[fatal] No Gemini API key configured. Set GEMINI_API_KEYS (comma-separated), GEMINI_API_KEY_1+, or GEMINI_API_KEY.');
  process.exit(1);
}
console.log(`[shiksha-anuvad] ${getKeyCount()} Gemini key(s) configured`);

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    model: getModel(),
    apiKeyCount: getKeyCount(),
    auth: 'supabase',
    allowedDomain: allowedDomain(),
    supabaseConfigured: isSupabaseConfigured(),
  });
});

app.post('/api/translate', async (req: Request, res: Response) => {
  const user = await authenticate(req, res);
  if (!user) return;
  try {
    const { content } = req.body || {};
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }
    const result = await translateForUser(user, req.body);
    return res.json(result);
  } catch (err: any) {
    console.error('[translate] error:', err?.message || err);
    return res.status(500).json({ error: 'Failed to translate content. Please try again.' });
  }
});

app.post('/api/analyze', async (req: Request, res: Response) => {
  if (!(await authenticate(req, res))) return;
  try {
    const { content } = req.body || {};
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }
    const result = await analyze(req.body);
    return res.json(result);
  } catch (err: any) {
    console.error('[analyze] error:', err?.message || err);
    return res.status(500).json({ error: 'Failed to analyze content.' });
  }
});

app.get('/api/glossary', async (req: Request, res: Response) => {
  const user = await authenticate(req, res);
  if (!user) return;
  const language = String(req.query.language || 'Hindi');
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  try {
    return res.json(q ? { terms: await lookupTerm(user, language, q) } : await glossaryInfo(user, language));
  } catch (err: any) {
    console.error('[glossary] error:', err?.message || err);
    return res.status(500).json({ error: 'Could not read the glossary.' });
  }
});

const distPath = path.resolve(__dirname, '..', 'dist');
if (fs.existsSync(path.join(distPath, 'index.html'))) {
  app.use(express.static(distPath));
  app.get(/^(?!\/api).*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
  console.log(`[shiksha-anuvad] serving built frontend from ${distPath}`);
} else {
  console.log('[shiksha-anuvad] no dist/ found — API-only mode (run `vite` separately for the frontend)');
}

app.listen(PORT, () => {
  console.log(`[shiksha-anuvad] API listening on http://localhost:${PORT}`);
});
