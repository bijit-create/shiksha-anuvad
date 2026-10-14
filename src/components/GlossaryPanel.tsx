import { useEffect, useRef, useState } from 'react';
import { BookOpen, Search, Loader2, X } from 'lucide-react';
import type { GlossaryInfo, GlossaryLookupRow } from '../types';
import { glossaryInfo, lookupGlossary } from '../services/geminiService';

// The glossary the translator is using right now: version, last update, and a term lookup.
// Pipeline syncs bump the version; the server picks a new version up within 60 s, and so does this panel.

function ago(iso: string | null): string {
  if (!iso) return 'unknown';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

const grades = (r: GlossaryLookupRow) =>
  r.gradeMin == null ? '' : r.gradeMin === r.gradeMax ? `grade ${r.gradeMin}` : `grades ${r.gradeMin}–${r.gradeMax}`;

export default function GlossaryPanel({ language }: { language: string }) {
  const [info, setInfo] = useState<GlossaryInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<GlossaryLookupRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    let live = true;
    const load = () => glossaryInfo(language)
      .then(i => { if (live) { setInfo(i); setInfoError(null); } })
      .catch(e => { if (live) setInfoError(e.message); });
    load();
    const t = setInterval(load, 60_000);
    return () => { live = false; clearInterval(t); };
  }, [language]);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setRows(null); setSearchError(null); return; }
    const mine = ++seq.current;
    setSearching(true);
    const t = setTimeout(() => {
      lookupGlossary(language, query)
        .then(r => { if (mine === seq.current) { setRows(r); setSearchError(null); } })
        .catch(e => { if (mine === seq.current) setSearchError(e.message); })
        .finally(() => { if (mine === seq.current) setSearching(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [q, language]);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 p-4 space-y-3">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-zinc-600 flex-1 min-w-0">
          <BookOpen className="w-4 h-4 text-indigo-600 shrink-0" />
          <span className="font-semibold text-zinc-800">ConveGenius glossary</span>
          {info ? (
            <span className="text-xs text-zinc-500 truncate">
              v{info.version} · updated {ago(info.updatedAt)}
            </span>
          ) : infoError ? (
            <span className="text-xs text-red-600">Glossary unavailable: {infoError}</span>
          ) : (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />
          )}
        </div>
        <div className="relative md:w-72">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={`Look up a term (English or ${language})`}
            className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-8 pr-8 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
          />
          {q && (
            <button onClick={() => setQ('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600" aria-label="Clear">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {q.trim().length >= 2 && (
        <div className="border-t border-zinc-100 pt-3">
          {searchError ? (
            <p className="text-xs text-red-600">{searchError}</p>
          ) : searching && !rows ? (
            <p className="text-xs text-zinc-400 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…</p>
          ) : rows && rows.length === 0 ? (
            <p className="text-xs text-zinc-500">No {language} entry for “{q.trim()}”. The translator will use the NCERT textbook term.</p>
          ) : rows ? (
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-zinc-400 text-left">
                  <tr><th className="py-1 pr-3 font-semibold">English</th><th className="py-1 pr-3 font-semibold">{language}</th><th className="py-1 font-semibold">Status</th></tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t border-zinc-50 align-top">
                      <td className="py-1.5 pr-3">
                        <div className="text-zinc-800">{r.en}</div>
                        <div className="text-[11px] text-zinc-400">{[r.sense, grades(r), r.kind !== 'term' ? `${r.kind.replace('_', ' ')} (not enforced)` : ''].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="py-1.5 pr-3">
                        <div className="font-hindi text-zinc-800">{r.target}</div>
                        {r.variants.length > 0 && <div className="text-[11px] text-zinc-400 font-hindi">also: {r.variants.slice(0, 5).join(', ')}</div>}
                      </td>
                      <td className="py-1.5">
                        <span className={r.status === 'approved'
                          ? 'text-[11px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700'
                          : 'text-[11px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700'}>
                          {r.status === 'approved' ? 'Approved' : 'Textbook'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
