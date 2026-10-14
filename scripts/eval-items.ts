// Translate the English rows of a question-bank extract with the item engine, for T-QSI scoring.
//
//   npx tsx scripts/eval-items.ts <bank.json> <out_dir> [--langs Hindi,Telugu] [--snos 1-100] [--concurrency 6]
//
// <bank.json> is {header, rows} with one object per bank row (columns as in the "Questions" sheet).
// Needs GEMINI_API_KEY(S) and GLOSSARY_LOADER_TOKEN in the environment or in .env / .env.local.
// Writes <out_dir>/results.jsonl (one line per S.No × language; resumable) and <out_dir>/rows.json,
// the target rows with the new translations, ready to be written into a bank copy.
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { translateItem } from '../server/lib/engine.js';
import { getGlossaryForScript, LanguageGlossary } from '../server/lib/glossary.js';
import { getModel } from '../server/lib/gemini.js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const [bankPath, outDir] = args;
if (!bankPath || !outDir) {
  console.error('usage: eval-items.ts <bank.json> <out_dir> [--langs Hindi,Telugu] [--snos 1-100] [--concurrency 6]');
  process.exit(1);
}
const langs = opt('--langs', 'Hindi,Telugu').split(',');
const [lo, hi] = opt('--snos', '1-100').split('-').map(Number);
const concurrency = Number(opt('--concurrency', '6'));
const OPT_COLS = Array.from({ length: 13 }, (_, i) => `Option ${i + 1}`);

type Row = Record<string, string | null>;
const bank: { header: string[]; rows: Row[] } = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
const v = (r: Row, c: string) => (r[c] ?? '').toString();

/** "Geometry – Grade 6 to 10" → "10": the top of the range, so glossary terms first taught later are left out. */
function gradeOf(topic: string): string | undefined {
  const m = topic.match(/Grade\s*(\d+)(?:\s*to\s*(\d+))?/i);
  return m ? (m[2] || m[1]) : undefined;
}

fs.mkdirSync(outDir, { recursive: true });
const resultsPath = path.join(outDir, 'results.jsonl');
const done = new Map<string, any>();
if (fs.existsSync(resultsPath)) {
  for (const line of fs.readFileSync(resultsPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    done.set(`${r.sno}|${r.language}`, r);
  }
}

const token = (process.env.GLOSSARY_LOADER_TOKEN || '').trim();
if (!token) console.warn('GLOSSARY_LOADER_TOKEN not set: translating without the glossary');
const glossaries: Record<string, LanguageGlossary | null> = {};
for (const lang of langs) {
  glossaries[lang] = token ? await getGlossaryForScript(token, lang) : null;
  console.log(`${lang}: glossary ${glossaries[lang] ? `v${glossaries[lang]!.version}, ${glossaries[lang]!.size} entries` : 'none'}`);
}

const english = bank.rows.filter(r => v(r, 'Language') === 'English' && Number(v(r, 'S.No')) >= lo && Number(v(r, 'S.No')) <= hi);
const jobs = english.flatMap(en => langs.map(lang => ({ en, lang })))
  .filter(j => !done.has(`${v(j.en, 'S.No')}|${j.lang}`));
console.log(`model ${getModel()} · ${english.length} English rows · ${jobs.length} to translate · ${done.size} done before`);

let next = 0, finished = 0, failed = 0;
const started = Date.now();
async function worker() {
  while (next < jobs.length) {
    const { en, lang } = jobs[next++];
    const sno = Number(v(en, 'S.No'));
    const item = { question: v(en, 'Question Text'), options: OPT_COLS.map(c => v(en, c)).filter(Boolean), answer: v(en, 'Correct Answer') };
    try {
      const r = await translateItem({
        item, targetLanguage: lang, grade: gradeOf(v(en, 'Topic')), subject: 'Mathematics',
        topic: v(en, 'Topic'), format: v(en, 'Format'),
      }, glossaries[lang]);
      const rec = { sno, language: lang, source: item, ...r };
      fs.appendFileSync(resultsPath, JSON.stringify(rec) + '\n');
      done.set(`${sno}|${lang}`, rec);
      finished++;
    } catch (err: any) {
      failed++;
      console.warn(`S.No ${sno} ${lang}: ${err?.message || err}`);
    }
    if ((finished + failed) % 10 === 0) {
      console.log(`${finished + failed}/${jobs.length} · ${failed} failed · ${Math.round((Date.now() - started) / 1000)} s`);
    }
  }
}
await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

// Target rows with the new translations; metadata (IDs, image column, Is Deleted) is kept from the bank.
const rows: Row[] = [];
for (const r of bank.rows) {
  const lang = v(r, 'Language');
  const rec = done.get(`${v(r, 'S.No')}|${lang}`);
  if (!rec) { rows.push(r); continue; }
  const out: Row = { ...r, 'Question Text': rec.item.question, 'Correct Answer': rec.item.answer, "Stored 'answer' field (raw)": rec.item.answer };
  OPT_COLS.forEach((c, i) => { out[c] = rec.item.options[i] ?? null; });
  rows.push(out);
}
fs.writeFileSync(path.join(outDir, 'rows.json'), JSON.stringify({ header: bank.header, rows }, null, 0));

const all = [...done.values()];
const sum = (f: (r: any) => number) => all.reduce((n, r) => n + f(r), 0);
const tokens = sum(r => r.usage.reduce((n: number, u: any) => n + u.inputTokens + u.outputTokens, 0));
const models = [...new Set(all.flatMap(r => r.usage.map((u: any) => u.model)))];
const terms = all.flatMap(r => r.glossary?.terms || []);
console.log(JSON.stringify({
  translated: all.length, failed,
  cleanFirstDraft: all.filter(r => !r.firstFindings.length).length,
  repairedKept: all.filter(r => r.repaired).length,
  findingsLeft: sum(r => r.findings.length),
  glossaryTermsFound: `${terms.filter((t: any) => t.found).length}/${terms.length}`,
  models, tokens,
}, null, 1));
