# Shiksha Anuvad — NCERT-Aligned English to Hindi Translator

Contextual educational-content translator. Translates English into grade-appropriate Hindi (KG–12) following NCERT standards, with typeset math rendering powered by KaTeX.

## Features

- **Grade-aware translation** (KG–Grade 12) across 12 NCERT subjects.
- **Contextual, not literal** — preserves pedagogical intent, adapts vocabulary to the grade.
- **Math-aware**: math expressions are detected, wrapped, and rendered as typeset LaTeX via KaTeX.
- **Excel batch mode**: upload `.xlsx` / `.xls`, pick columns and row ranges, get a file back with `(Hindi)` columns inserted.
- **Smart analysis**: key concepts, vocabulary, NCERT alignment notes, activity ideas.
- **Rate-limit resilience**: exponential backoff on Gemini 429 responses.
- **Server-side API key** — the Gemini key never leaves the backend.

## Architecture

```
 React (Vite)          ┌─► Vercel Serverless Functions (prod)
    /api/translate ────┤      api/translate.ts
    /api/analyze       └─► Express server       (local dev)
                              server/index.ts
                                  │
                                  ▼
                       server/lib/gemini.ts  ← shared Gemini logic
                                  │
                                  ▼
                            Google Gemini API
```

Both the Express dev server and the Vercel Serverless Functions import from a single shared module (`server/lib/gemini.ts`), so prod and dev stay in lockstep.

## Run locally

**Prerequisites:** Node.js 20+.

```bash
npm install
cp .env.example .env.local         # then fill in GEMINI_API_KEY
npm run dev
#   → frontend at http://localhost:3000
#   → API       at http://localhost:8080
```

Get a Gemini API key at https://aistudio.google.com/app/apikey.

### Alternative: run them separately

```bash
npm run dev:server    # Express on :8080 (live reload via tsx watch)
npm run dev:client    # Vite on :3000, proxies /api to :8080
```

## Deploy to Vercel (recommended)

The repo is Vercel-ready:
- `vercel.json` pins the framework to Vite.
- `api/health.ts`, `api/translate.ts`, `api/analyze.ts` become Serverless Functions automatically.
- `GEMINI_API_KEY` stays server-side as a Vercel env var.

### One-time setup

```bash
npm i -g vercel
vercel login
vercel link        # link this folder to a Vercel project
```

### Set the API key as a Vercel env var

```bash
vercel env add GEMINI_API_KEY        # paste the key when prompted
# repeat for: production, preview, development
```

(Or set it in the Vercel dashboard → Project → Settings → Environment Variables.)

### Deploy

```bash
vercel              # preview deploy
vercel --prod       # production deploy
```

Alternatively, connect the GitHub repo in the Vercel dashboard and every push will auto-deploy.

### Local dev with Vercel runtime

`vercel dev` runs the Serverless Functions locally with Vercel's runtime (no Express). Useful if you want production-identical local behavior:

```bash
vercel dev          # serves both the Vite frontend and /api/* functions on one port
```

`npm run dev` (Vite + Express) is still the fastest inner loop; `vercel dev` is for parity testing.

## Alternative deploy: Docker / Cloud Run / any container host

Single-container Node 20 image — Express serves API + built frontend on port 8080.

```bash
docker build -t shiksha-anuvad .
docker run --rm -p 8080:8080 -e GEMINI_API_KEY=your_key shiksha-anuvad
```

```bash
gcloud run deploy shiksha-anuvad \
  --source . \
  --port 8080 \
  --region asia-south1 \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY=your_key_here
```

## Why not Streamlit?

Streamlit is Python-only — hosting this app there would mean rewriting the whole React/TypeScript frontend (and the KaTeX + xlsx + markdown pipelines) in Python/Streamlit widgets. Vercel runs the existing code as-is.

## API endpoints

| Method | Path             | Body                                                           | Returns                          |
|--------|------------------|----------------------------------------------------------------|----------------------------------|
| GET    | `/api/health`    | —                                                              | `{ ok, model }`                  |
| POST   | `/api/translate` | `{ content, grade?, subject?, contentType?, additionalContext? }` | `{ translatedText, explanation }` |
| POST   | `/api/analyze`   | `{ content, grade?, subject? }`                                | `ContentAnalysis`                |

## Environment variables

| Variable          | Required | Default                   | Notes                                               |
|-------------------|----------|---------------------------|-----------------------------------------------------|
| `GEMINI_API_KEY`  | yes      | —                         | Server-side only. Set as a Vercel env var.          |
| `GEMINI_MODEL`    | no       | `gemini-3.1-pro-preview`  | Override to any available Gemini model.             |
| `PORT`            | no       | `8080`                    | Express HTTP port (ignored on Vercel).              |
| `BACKEND_URL`     | no (dev) | `http://localhost:8080`   | Vite dev-server proxy target.                       |

## Project layout

```
src/
  components/Translator.tsx     # UI: text mode, Excel mode, LaTeX guide, analysis
  services/geminiService.ts     # Thin fetch wrapper — calls /api/*
  types.ts
  main.tsx                      # React entry + KaTeX CSS
  index.css                     # Tailwind theme + markdown/KaTeX styles
server/
  lib/gemini.ts                 # SHARED: Gemini SDK + math-marker rewriting + retry
  index.ts                      # Local dev Express server (uses lib/gemini.ts)
api/
  health.ts                     # Vercel fn: GET /api/health
  translate.ts                  # Vercel fn: POST /api/translate
  analyze.ts                    # Vercel fn: POST /api/analyze
vercel.json                     # Vercel build config
Dockerfile                      # Node-runtime container (Cloud Run / Fly / etc.)
```

## How math rendering works

1. Gemini wraps every math expression in `[MATH_START]...[MATH_END]` tags — JSON-safe, no backslash-escape pitfalls.
2. The backend rewrites those tags to `$...$` inline math delimiters.
3. On the client, `react-markdown` + `remark-math` + `rehype-katex` render them as typeset math.
