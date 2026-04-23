import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { translate, analyze, getModel } from './lib/gemini.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '8080', 10);

if (!process.env.GEMINI_API_KEY) {
  console.error('[fatal] GEMINI_API_KEY is not set. Copy .env.example to .env.local and fill it in.');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, model: getModel() });
});

app.post('/api/translate', async (req: Request, res: Response) => {
  try {
    const { content } = req.body || {};
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }
    const result = await translate(req.body);
    return res.json(result);
  } catch (err: any) {
    console.error('[translate] error:', err?.message || err);
    return res.status(500).json({ error: 'Failed to translate content. Please try again.' });
  }
});

app.post('/api/analyze', async (req: Request, res: Response) => {
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
