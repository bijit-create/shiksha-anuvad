import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Languages,
  Layers,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Send,
  Upload,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { GradeLevel, Subject } from '../types';
import { translateContent } from '../services/geminiService';
import { runWithConcurrency } from '../lib/concurrency';
import {
  Cell,
  LangCode,
  LANG_CODES,
  LANG_CODE_TO_NAME,
  LanguagePlan,
  RunOptions,
  SheetPlan,
  applySplicesForSheet,
  buildCellsForSheet,
  defaultLanguagePlans,
  detectAllSheets,
  estimateCells,
} from '../lib/excelPlan';
import {
  hashBuffer,
  loadPersistedState,
  savePersistedState,
  clearPersistedState,
  PersistedState,
} from '../lib/persistence';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Props {
  grade: GradeLevel;
  subject: Subject;
}

type Phase = 'upload' | 'review' | 'running' | 'paused' | 'done';

interface State {
  phase: Phase;
  fileName: string;
  fileHash: string;
  buffer: ArrayBuffer | null;
  sheetPlans: SheetPlan[];
  languagePlans: LanguagePlan[];
  options: RunOptions;
  resumeOffer: PersistedState | null;
  errorMsg: string | null;
}

type Action =
  | { type: 'fileLoaded'; fileName: string; fileHash: string; buffer: ArrayBuffer; sheetPlans: SheetPlan[]; languagePlans: LanguagePlan[]; resumeOffer: PersistedState | null }
  | { type: 'discardResumeOffer' }
  | { type: 'restoredFromPersisted'; persisted: PersistedState; buffer: ArrayBuffer }
  | { type: 'toggleSheetIncluded'; sheet: string }
  | { type: 'toggleLanguage'; code: LangCode }
  | { type: 'setSkipFilled'; value: boolean }
  | { type: 'setConcurrency'; value: number }
  | { type: 'setHeaderRow'; sheet: string; idx: number }
  | { type: 'phaseChange'; phase: Phase }
  | { type: 'errorMsg'; msg: string | null }
  | { type: 'reset' };

const INITIAL_STATE = (grade: GradeLevel, subject: Subject): State => ({
  phase: 'upload',
  fileName: '',
  fileHash: '',
  buffer: null,
  sheetPlans: [],
  languagePlans: [],
  options: { skipFilled: true, concurrency: 4, grade, subject },
  resumeOffer: null,
  errorMsg: null,
});

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'fileLoaded':
      return {
        ...state,
        phase: 'review',
        fileName: action.fileName,
        fileHash: action.fileHash,
        buffer: action.buffer,
        sheetPlans: action.sheetPlans,
        languagePlans: action.languagePlans,
        resumeOffer: action.resumeOffer,
        errorMsg: null,
      };
    case 'discardResumeOffer':
      return { ...state, resumeOffer: null };
    case 'restoredFromPersisted':
      return {
        ...state,
        phase: action.persisted.cells.some(c => c.status === 'pending' || c.status === 'error') ? 'paused' : 'done',
        fileName: action.persisted.fileName,
        fileHash: action.persisted.fileHash,
        buffer: action.buffer,
        sheetPlans: action.persisted.sheetPlans,
        languagePlans: action.persisted.languagePlans,
        options: action.persisted.options,
        resumeOffer: null,
        errorMsg: null,
      };
    case 'toggleSheetIncluded':
      return {
        ...state,
        sheetPlans: state.sheetPlans.map(sp =>
          sp.name === action.sheet ? { ...sp, included: sp.eligible ? !sp.included : false } : sp,
        ),
      };
    case 'toggleLanguage':
      return {
        ...state,
        languagePlans: state.languagePlans.map(lp =>
          lp.code === action.code ? { ...lp, enabled: !lp.enabled } : lp,
        ),
      };
    case 'setSkipFilled':
      return { ...state, options: { ...state.options, skipFilled: action.value } };
    case 'setConcurrency':
      return { ...state, options: { ...state.options, concurrency: action.value } };
    case 'setHeaderRow':
      return {
        ...state,
        sheetPlans: state.sheetPlans.map(sp =>
          sp.name === action.sheet ? { ...sp, headerRowIdx: action.idx } : sp,
        ),
      };
    case 'phaseChange':
      return { ...state, phase: action.phase };
    case 'errorMsg':
      return { ...state, errorMsg: action.msg };
    case 'reset':
      return INITIAL_STATE(state.options.grade, state.options.subject);
  }
}

export default function BatchExcelWizard({ grade, subject }: Props) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE(grade, subject));

  // Mutable run-time data: kept in refs so 10k-cell mutations don't trigger re-renders.
  // A 250ms ticker drives re-renders during the run.
  const cellsRef = useRef<Cell[]>([]);
  const aoaBySheetRef = useRef<Record<string, any[][]>>({});
  const completedRef = useRef(0);
  const errorRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (state.phase !== 'running') return;
    const id = setInterval(() => forceTick(t => t + 1), 250);
    return () => clearInterval(id);
  }, [state.phase]);

  // Keep grade/subject in options in sync with parent props (the global controls).
  useEffect(() => {
    if (state.options.grade !== grade || state.options.subject !== subject) {
      // No action — read live from props in the run worker so grade/subject changes
      // mid-batch are picked up at translate time. Stored values are only used
      // for persistence rehydration.
    }
  }, [grade, subject, state.options.grade, state.options.subject]);

  // ----- File upload + detection -----
  const handleFileUpload = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const fileHash = await hashBuffer(buffer);
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
      const sheetPlans = detectAllSheets(wb);
      const languagePlans = defaultLanguagePlans(sheetPlans);

      // Look for prior run on the same file (by hash).
      const persisted = loadPersistedState();
      const resumeOffer = persisted && persisted.fileHash === fileHash ? persisted : null;

      dispatch({
        type: 'fileLoaded',
        fileName: file.name,
        fileHash,
        buffer,
        sheetPlans,
        languagePlans,
        resumeOffer,
      });
    } catch (err: any) {
      dispatch({ type: 'errorMsg', msg: err?.message || 'Failed to read the file.' });
    }
  };

  const handleResumeAccept = () => {
    if (!state.resumeOffer || !state.buffer) return;
    // Rehydrate aoaBySheet from the buffer + apply splices using the persisted plans, then
    // overlay completed cell results.
    try {
      const wb = XLSX.read(new Uint8Array(state.buffer), { type: 'array' });
      const aoaBySheet: Record<string, any[][]> = {};
      const enabledLangs = state.resumeOffer.languagePlans.filter(l => l.enabled).map(l => l.code);
      for (const sp of state.resumeOffer.sheetPlans) {
        if (!sp.eligible || !sp.included) continue;
        const aoa = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sp.name], { header: 1, defval: '' });
        applySplicesForSheet(aoa, sp, enabledLangs);
        aoaBySheet[sp.name] = aoa;
      }
      // Replay completed-cell results into the AOAs.
      for (const cell of state.resumeOffer.cells) {
        if (cell.status === 'done' && cell.result !== undefined) {
          const aoa = aoaBySheet[cell.sheet];
          if (aoa && aoa[cell.rowIdx]) aoa[cell.rowIdx][cell.targetIdx] = cell.result;
        }
      }
      cellsRef.current = state.resumeOffer.cells;
      aoaBySheetRef.current = aoaBySheet;
      completedRef.current = state.resumeOffer.completedCount;
      errorRef.current = state.resumeOffer.errorCount;

      dispatch({ type: 'restoredFromPersisted', persisted: state.resumeOffer, buffer: state.buffer });
    } catch (err: any) {
      dispatch({ type: 'errorMsg', msg: err?.message || 'Failed to restore previous run.' });
      dispatch({ type: 'discardResumeOffer' });
    }
  };

  // ----- Run -----
  const startRun = async (rerunMode: 'fresh' | 'retry-errors' = 'fresh') => {
    if (!state.buffer) return;
    try {
      let cells: Cell[];
      if (rerunMode === 'fresh') {
        // Build the AOAs from the buffer, splice, build cell list.
        const wb = XLSX.read(new Uint8Array(state.buffer), { type: 'array' });
        const aoaBySheet: Record<string, any[][]> = {};
        const enabledLangs = state.languagePlans.filter(l => l.enabled).map(l => l.code);
        const allCells: Cell[] = [];

        for (const sp of state.sheetPlans) {
          if (!sp.eligible || !sp.included) continue;
          const aoa = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sp.name], { header: 1, defval: '' });
          const spliceResult = applySplicesForSheet(aoa, sp, enabledLangs);
          const sheetCells = buildCellsForSheet(aoa, sp, enabledLangs, spliceResult, {
            skipFilled: state.options.skipFilled,
          });
          aoaBySheet[sp.name] = aoa;
          allCells.push(...sheetCells);
        }

        cellsRef.current = allCells;
        aoaBySheetRef.current = aoaBySheet;
        completedRef.current = 0;
        errorRef.current = 0;
        startedAtRef.current = Date.now();
        cells = allCells;
      } else {
        // Retry only errored cells, in place.
        cells = cellsRef.current;
        for (const c of cells) {
          if (c.status === 'error') c.status = 'pending';
        }
      }

      // Indices into cells[] of the work to do this pass.
      const workIndices: number[] = [];
      cells.forEach((c, i) => {
        if (c.status === 'pending') workIndices.push(i);
      });

      if (workIndices.length === 0) {
        dispatch({ type: 'phaseChange', phase: 'done' });
        return;
      }

      const ac = new AbortController();
      abortRef.current = ac;
      dispatch({ type: 'phaseChange', phase: 'running' });

      await runWithConcurrency(
        workIndices.length,
        state.options.concurrency,
        async (i, signal) => {
          const cellIdx = workIndices[i];
          const cell = cells[cellIdx];
          cell.status = 'running';
          const result = await translateContent(
            {
              content: cell.sourceText,
              grade,
              subject,
              contentType: cell.sheet,
              additionalContext: cell.rowContext,
              targetLanguage: LANG_CODE_TO_NAME[cell.lang],
            },
            { signal },
          );
          // Write result into the in-memory AOA.
          const aoa = aoaBySheetRef.current[cell.sheet];
          if (aoa && aoa[cell.rowIdx]) aoa[cell.rowIdx][cell.targetIdx] = result.translatedText;
          cell.result = result.translatedText;
          cell.status = 'done';
          return result;
        },
        (i, result) => {
          const cellIdx = workIndices[i];
          const cell = cells[cellIdx];
          if (result instanceof Error) {
            cell.status = 'error';
            cell.error = result.message;
            errorRef.current++;
          } else {
            completedRef.current++;
          }
          // Persist every 200 completions.
          if ((completedRef.current + errorRef.current) % 200 === 0) {
            persistNow();
          }
        },
        ac.signal,
      );

      // Run finished — either completed all, or aborted.
      persistNow();
      const stillPending = cells.some(c => c.status === 'pending' || c.status === 'running');
      const stillErrored = cells.some(c => c.status === 'error');
      dispatch({
        type: 'phaseChange',
        phase: ac.signal.aborted ? 'paused' : (stillErrored && !stillPending ? 'done' : 'done'),
      });
    } catch (err: any) {
      dispatch({ type: 'errorMsg', msg: err?.message || 'Run failed unexpectedly.' });
      dispatch({ type: 'phaseChange', phase: 'paused' });
    }
  };

  const persistNow = () => {
    if (!state.fileHash) return;
    savePersistedState({
      fileHash: state.fileHash,
      fileName: state.fileName,
      sheetPlans: state.sheetPlans,
      languagePlans: state.languagePlans,
      options: state.options,
      cells: cellsRef.current,
      completedCount: completedRef.current,
      errorCount: errorRef.current,
    });
  };

  const cancelRun = () => {
    abortRef.current?.abort();
    dispatch({ type: 'phaseChange', phase: 'paused' });
  };

  const downloadResult = () => {
    if (!state.buffer) return;
    const wb = XLSX.read(new Uint8Array(state.buffer), { type: 'array' });
    for (const [sheetName, aoa] of Object.entries(aoaBySheetRef.current)) {
      wb.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(aoa);
    }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const baseName = state.fileName.replace(/\.xlsx?$/i, '');
    XLSX.writeFile(wb, `Translated_${baseName}_${stamp}.xlsx`);
  };

  const reset = () => {
    abortRef.current?.abort();
    cellsRef.current = [];
    aoaBySheetRef.current = {};
    completedRef.current = 0;
    errorRef.current = 0;
    clearPersistedState();
    dispatch({ type: 'reset' });
  };

  // ----- Render -----
  return (
    <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-zinc-100 space-y-8 max-w-5xl mx-auto">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-zinc-700 uppercase tracking-wide flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
          Batch Excel Translation
        </h2>
        <PhaseBreadcrumb phase={state.phase} />
      </header>

      {state.errorMsg && (
        <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{state.errorMsg}</span>
          <button onClick={() => dispatch({ type: 'errorMsg', msg: null })} className="text-xs font-bold uppercase">Dismiss</button>
        </div>
      )}

      {state.phase === 'upload' && (
        <UploadStep onPick={handleFileUpload} />
      )}

      {state.phase === 'review' && (
        <ReviewStep
          state={state}
          dispatch={dispatch}
          onStart={() => startRun('fresh')}
          onBack={reset}
          onResumeAccept={handleResumeAccept}
        />
      )}

      {(state.phase === 'running' || state.phase === 'paused' || state.phase === 'done') && (
        <RunStep
          state={state}
          cells={cellsRef.current}
          completed={completedRef.current}
          errors={errorRef.current}
          startedAt={startedAtRef.current}
          onCancel={cancelRun}
          onResume={() => startRun('retry-errors')}
          onRetryFailed={() => startRun('retry-errors')}
          onDownload={downloadResult}
          onReReview={() => dispatch({ type: 'phaseChange', phase: 'review' })}
          onReset={reset}
        />
      )}
    </div>
  );
}

// ============================================================
// UploadStep
// ============================================================
function UploadStep({ onPick }: { onPick: (f: File) => void }) {
  return (
    <div className="border-2 border-dashed border-zinc-300 rounded-2xl p-12 flex flex-col items-center justify-center text-center hover:bg-zinc-50 hover:border-indigo-300 transition-colors cursor-pointer relative group">
      <input
        type="file"
        accept=".xlsx, .xls"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
        }}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
      />
      <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
        <Upload className="w-8 h-8 text-indigo-600" />
      </div>
      <p className="text-base font-bold text-zinc-800">Click or drag Excel file to upload</p>
      <p className="text-sm text-zinc-500 mt-2">Supports multi-sheet .xlsx and .xls workbooks</p>
    </div>
  );
}

// ============================================================
// ReviewStep
// ============================================================
function ReviewStep({
  state,
  dispatch,
  onStart,
  onBack,
  onResumeAccept,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  onStart: () => void;
  onBack: () => void;
  onResumeAccept: () => void;
}) {
  const eligibleSheets = state.sheetPlans.filter(sp => sp.eligible);
  const ineligibleSheets = state.sheetPlans.filter(sp => !sp.eligible);
  const totalEligibleRows = eligibleSheets.reduce((sum, sp) => sum + sp.rowCount, 0);

  const enabledLangs = useMemo(
    () => state.languagePlans.filter(l => l.enabled).map(l => l.code),
    [state.languagePlans],
  );

  const estimate = useMemo(
    () => estimateCells(state.sheetPlans, state.languagePlans, state.options),
    [state.sheetPlans, state.languagePlans, state.options],
  );

  const etaMinutes = Math.ceil((estimate.total * 3) / state.options.concurrency / 60);
  const canStart = estimate.total > 0 && enabledLangs.length > 0 &&
    state.sheetPlans.some(s => s.eligible && s.included);

  const [showIneligible, setShowIneligible] = useState(false);

  return (
    <div className="space-y-6">
      {state.resumeOffer && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <RotateCcw className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="text-sm font-bold text-amber-900">Resume previous run?</p>
            <p className="text-xs text-amber-800">
              {state.resumeOffer.completedCount} cells already translated for{' '}
              <span className="font-mono">{state.resumeOffer.fileName}</span>.
            </p>
          </div>
          <button
            onClick={onResumeAccept}
            className="text-xs font-bold uppercase tracking-wider px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
          >
            Resume
          </button>
          <button
            onClick={() => dispatch({ type: 'discardResumeOffer' })}
            className="text-xs font-bold uppercase tracking-wider text-amber-700 hover:text-amber-900 px-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* File summary */}
      <div className="flex items-center justify-between p-4 bg-zinc-50 rounded-xl border border-zinc-200">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-white rounded-lg shadow-sm">
            <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-zinc-800">{state.fileName}</p>
            <p className="text-xs font-medium text-zinc-500 mt-0.5">
              {state.sheetPlans.length} sheets · {eligibleSheets.length} eligible ({totalEligibleRows.toLocaleString()} rows) · {ineligibleSheets.length} skipped
            </p>
          </div>
        </div>
        <button
          onClick={onBack}
          className="text-xs font-bold text-red-600 hover:text-red-700 uppercase tracking-wider px-3 py-1.5 hover:bg-red-50 rounded-lg transition-colors"
        >
          Remove
        </button>
      </div>

      {/* Sheet picker */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold text-zinc-700 uppercase tracking-wide flex items-center gap-2">
          <Layers className="w-4 h-4 text-indigo-600" />
          Sheets to translate
        </h3>
        <div className="border border-zinc-200 rounded-xl overflow-hidden divide-y divide-zinc-100">
          {eligibleSheets.map(sp => (
            <SheetRow key={sp.name} plan={sp} dispatch={dispatch} languagePlans={state.languagePlans} />
          ))}
        </div>

        {ineligibleSheets.length > 0 && (
          <div>
            <button
              onClick={() => setShowIneligible(v => !v)}
              className="text-xs font-semibold text-zinc-500 hover:text-zinc-700 underline"
            >
              {showIneligible ? 'Hide' : 'Show'} {ineligibleSheets.length} ineligible sheet{ineligibleSheets.length === 1 ? '' : 's'}
            </button>
            {showIneligible && (
              <ul className="mt-2 space-y-1 text-xs text-zinc-500">
                {ineligibleSheets.map(sp => (
                  <li key={sp.name} className="flex items-center gap-2">
                    <span className="font-mono text-zinc-400">{sp.name}</span>
                    <span className="text-zinc-400">— {sp.ineligibleReason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Languages */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold text-zinc-700 uppercase tracking-wide flex items-center gap-2">
          <Languages className="w-4 h-4 text-indigo-600" />
          Target languages
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {state.languagePlans.map(lp => {
            const presentInAnySheet = state.sheetPlans.some(sp =>
              sp.eligible && sp.included && sp.existingTargets[lp.code],
            );
            return (
              <label
                key={lp.code}
                className={cn(
                  'flex items-center gap-2 p-2.5 border rounded-xl cursor-pointer transition-all text-sm',
                  lp.enabled
                    ? 'border-indigo-600 bg-indigo-50/50'
                    : 'border-zinc-200 hover:bg-zinc-50',
                )}
              >
                <input
                  type="checkbox"
                  checked={lp.enabled}
                  onChange={() => dispatch({ type: 'toggleLanguage', code: lp.code })}
                  className="w-4 h-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="font-mono text-xs text-zinc-500 w-7">{lp.code}</span>
                <span className="font-medium text-zinc-800 truncate">{lp.name}</span>
                {presentInAnySheet && (
                  <span className="ml-auto text-[10px] text-emerald-600 font-semibold uppercase">in-place</span>
                )}
              </label>
            );
          })}
        </div>
      </section>

      {/* Options */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold text-zinc-700 uppercase tracking-wide">Options</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex items-center gap-3 p-3 border border-zinc-200 rounded-xl cursor-pointer hover:bg-zinc-50">
            <input
              type="checkbox"
              checked={state.options.skipFilled}
              onChange={(e) => dispatch({ type: 'setSkipFilled', value: e.target.checked })}
              className="w-4 h-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div className="flex-1">
              <p className="text-sm font-medium text-zinc-800">Skip already-filled cells</p>
              <p className="text-[11px] text-zinc-500">Don't overwrite existing translations</p>
            </div>
          </label>
          <div className="flex items-center gap-3 p-3 border border-zinc-200 rounded-xl">
            <span className="text-sm font-medium text-zinc-800 flex-1">Concurrency</span>
            <select
              value={state.options.concurrency}
              onChange={(e) => dispatch({ type: 'setConcurrency', value: parseInt(e.target.value, 10) })}
              className="bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              {[2, 4, 6, 8].map(n => <option key={n} value={n}>{n}× parallel</option>)}
            </select>
          </div>
        </div>
      </section>

      {/* Estimate + Start */}
      <section className="pt-4 border-t border-zinc-100 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-sm text-zinc-700">
            <span className="font-bold text-indigo-600">{estimate.total.toLocaleString()}</span> cells to translate
            {estimate.total > 0 && (
              <> · ~{etaMinutes} min at {state.options.concurrency}× concurrency</>
            )}
          </p>
        </div>
        <button
          onClick={onStart}
          disabled={!canStart}
          className={cn(
            'w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg',
            !canStart
              ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed shadow-none'
              : 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.98] shadow-indigo-200/50',
          )}
        >
          <Send className="w-5 h-5" />
          Start translation
        </button>
      </section>
    </div>
  );
}

function SheetRow({
  plan,
  dispatch,
  languagePlans,
}: {
  plan: SheetPlan;
  dispatch: React.Dispatch<Action>;
  languagePlans: LanguagePlan[];
}) {
  return (
    <label className={cn(
      'flex items-start gap-3 p-3 hover:bg-zinc-50 cursor-pointer',
      plan.included && 'bg-indigo-50/30',
    )}>
      <input
        type="checkbox"
        checked={plan.included}
        onChange={() => dispatch({ type: 'toggleSheetIncluded', sheet: plan.name })}
        className="mt-1 w-4 h-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-zinc-800 text-sm truncate">{plan.name}</span>
          <span className="text-[11px] text-zinc-400">{plan.rowCount.toLocaleString()} rows</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          <span className="text-zinc-500">
            <span className="font-semibold">en</span> →
          </span>
          {LANG_CODES.map(lc => {
            const lp = languagePlans.find(l => l.code === lc);
            if (!lp || !lp.enabled) return null;
            const existing = plan.existingTargets[lc];
            const filled = plan.filledCounts[lc] || 0;
            if (existing) {
              return (
                <span key={lc} className="text-zinc-600">
                  <span className="font-mono font-semibold">{lc}</span>
                  <span className="text-zinc-400"> ({filled}/{plan.rowCount})</span>
                </span>
              );
            }
            return (
              <span key={lc} className="text-amber-700">
                <span className="font-mono font-semibold">+{lc}</span>
                <span className="text-amber-600"> (new)</span>
              </span>
            );
          })}
        </div>
      </div>
    </label>
  );
}

// ============================================================
// RunStep — running, paused, and done states
// ============================================================
function RunStep({
  state,
  cells,
  completed,
  errors,
  startedAt,
  onCancel,
  onResume,
  onRetryFailed,
  onDownload,
  onReReview,
  onReset,
}: {
  state: State;
  cells: Cell[];
  completed: number;
  errors: number;
  startedAt: number | null;
  onCancel: () => void;
  onResume: () => void;
  onRetryFailed: () => void;
  onDownload: () => void;
  onReReview: () => void;
  onReset: () => void;
}) {
  const total = cells.length;
  const skipped = cells.filter(c => c.status === 'skipped').length;
  const errored = cells.filter(c => c.status === 'error').length;
  const running = cells.filter(c => c.status === 'running').length;
  const remaining = total - completed - errored - skipped - running;
  const pct = total > 0 ? Math.round(((completed + skipped) / total) * 100) : 0;

  // ETA from rolling avg of cells/sec since start
  let etaText = '—';
  if (startedAt && completed > 5 && state.phase === 'running') {
    const elapsed = (Date.now() - startedAt) / 1000;
    const rate = completed / elapsed; // cells/sec
    const remainingCells = remaining + running;
    if (rate > 0 && remainingCells > 0) {
      const sec = Math.ceil(remainingCells / rate);
      etaText = sec > 60 ? `${Math.ceil(sec / 60)} min` : `${sec}s`;
    }
  }

  // Per-sheet rollup
  const bySheet = useMemo(() => {
    const m: Record<string, { byLang: Record<string, { done: number; total: number; error: number }> }> = {};
    for (const c of cells) {
      if (!m[c.sheet]) m[c.sheet] = { byLang: {} };
      if (!m[c.sheet].byLang[c.lang]) m[c.sheet].byLang[c.lang] = { done: 0, total: 0, error: 0 };
      const slot = m[c.sheet].byLang[c.lang];
      slot.total++;
      if (c.status === 'done') slot.done++;
      if (c.status === 'error') slot.error++;
    }
    return m;
  }, [cells, completed, errors]); // re-aggregate on tick

  const erroredCells = cells.filter(c => c.status === 'error').slice(0, 50);
  const [showErrors, setShowErrors] = useState(false);

  return (
    <div className="space-y-6">
      {/* Phase header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {state.phase === 'running' && <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />}
          {state.phase === 'paused' && <Pause className="w-5 h-5 text-amber-600" />}
          {state.phase === 'done' && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
          <div>
            <p className="text-sm font-bold text-zinc-800">
              {state.phase === 'running' && 'Translating in parallel…'}
              {state.phase === 'paused' && 'Run paused'}
              {state.phase === 'done' && 'Run complete'}
            </p>
            <p className="text-xs text-zinc-500">
              {completed.toLocaleString()} / {total.toLocaleString()} cells · {state.options.concurrency}× concurrency
              {state.phase === 'running' && <> · ETA {etaText}</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {state.phase === 'running' && (
            <button onClick={onCancel} className="text-xs font-bold uppercase tracking-wider px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 rounded-lg flex items-center gap-1.5">
              <Pause className="w-3.5 h-3.5" /> Cancel
            </button>
          )}
          {state.phase === 'paused' && remaining > 0 && (
            <button onClick={onResume} className="text-xs font-bold uppercase tracking-wider px-3 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg flex items-center gap-1.5">
              <Play className="w-3.5 h-3.5" /> Resume
            </button>
          )}
          {state.phase === 'done' && (
            <button onClick={onDownload} className="text-xs font-bold uppercase tracking-wider px-3 py-1.5 bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> Download .xlsx
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-zinc-500">
          <span>{pct}% done</span>
          <span>
            {errored > 0 && <span className="text-red-600 mr-3">{errored} errors</span>}
            {skipped > 0 && <span className="text-zinc-400">{skipped} skipped</span>}
          </span>
        </div>
        <div className="w-full bg-zinc-100 rounded-full h-2 overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-300',
              state.phase === 'done' ? 'bg-emerald-600' : 'bg-indigo-600',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Per-sheet breakdown */}
      <div className="border border-zinc-200 rounded-xl divide-y divide-zinc-100">
        {Object.entries(bySheet).map(([sheet, info]) => (
          <div key={sheet} className="p-3 text-xs">
            <p className="font-semibold text-zinc-800 mb-1">{sheet}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-zinc-600">
              {Object.entries(info.byLang).map(([lc, slot]) => {
                const isDone = slot.done === slot.total - slot.error;
                return (
                  <span key={lc} className={cn(
                    'flex items-center gap-1',
                    slot.error > 0 && 'text-red-600',
                    isDone && slot.error === 0 && 'text-emerald-700',
                  )}>
                    <span className="font-mono font-bold">{lc}</span>
                    <span>{slot.done}/{slot.total}</span>
                    {slot.error > 0 && <span>({slot.error} err)</span>}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Error tray */}
      {errored > 0 && (
        <div className="border border-red-200 rounded-xl bg-red-50/50">
          <button
            onClick={() => setShowErrors(v => !v)}
            className="w-full p-3 flex items-center justify-between text-sm font-semibold text-red-700"
          >
            <span className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {errored} failed cell{errored === 1 ? '' : 's'}
            </span>
            <span className="flex items-center gap-2">
              {state.phase !== 'running' && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); onRetryFailed(); }}
                  className="text-xs font-bold uppercase tracking-wider px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Retry failed
                </span>
              )}
              <ChevronRight className={cn('w-4 h-4 transition-transform', showErrors && 'rotate-90')} />
            </span>
          </button>
          {showErrors && (
            <ul className="px-3 pb-3 space-y-1 text-xs text-red-800 max-h-48 overflow-y-auto">
              {erroredCells.map((c, i) => (
                <li key={`${c.sheet}-${c.rowIdx}-${c.lang}-${i}`} className="font-mono">
                  {c.sheet} · row {c.rowIdx + 1} · {c.lang} — {c.error}
                </li>
              ))}
              {errored > erroredCells.length && (
                <li className="text-red-500 italic">…and {errored - erroredCells.length} more</li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* Done summary + secondary actions */}
      {state.phase === 'done' && (
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            onClick={onReReview}
            className="flex-1 px-4 py-3 bg-zinc-100 hover:bg-zinc-200 rounded-xl text-sm font-bold text-zinc-700 flex items-center justify-center gap-2"
          >
            <Layers className="w-4 h-4" /> Translate more languages
          </button>
          <button
            onClick={onReset}
            className="px-4 py-3 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-xl text-sm font-bold text-zinc-600 flex items-center justify-center gap-2"
          >
            <X className="w-4 h-4" /> Start over
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Phase breadcrumb
// ============================================================
function PhaseBreadcrumb({ phase }: { phase: Phase }) {
  const steps: { key: Phase; label: string }[] = [
    { key: 'upload', label: 'Upload' },
    { key: 'review', label: 'Review' },
    { key: 'running', label: 'Run' },
    { key: 'done', label: 'Done' },
  ];
  const currentIdx = steps.findIndex(s => {
    if (phase === 'paused' && s.key === 'running') return true;
    return s.key === phase;
  });
  return (
    <div className="hidden md:flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1">
          <span
            className={cn(
              'px-2 py-0.5 rounded',
              i < currentIdx && 'text-emerald-700 bg-emerald-50',
              i === currentIdx && 'text-indigo-700 bg-indigo-50',
              i > currentIdx && 'text-zinc-400 bg-zinc-50',
            )}
          >
            {s.label}
          </span>
          {i < steps.length - 1 && <ChevronRight className="w-3 h-3 text-zinc-300" />}
        </div>
      ))}
    </div>
  );
}
