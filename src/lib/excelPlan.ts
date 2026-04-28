import * as XLSX from 'xlsx';
import type { GradeLevel, Subject, Language } from '../types';

export type LangCode =
  | 'hi' | 'mr' | 'gu' | 'te' | 'bn' | 'ta' | 'kn' | 'ml'
  | 'pa' | 'ur' | 'or' | 'as' | 'sa';

export const LANG_CODE_TO_NAME: Record<LangCode, Language> = {
  hi: 'Hindi',
  mr: 'Marathi',
  gu: 'Gujarati',
  te: 'Telugu',
  bn: 'Bengali',
  ta: 'Tamil',
  kn: 'Kannada',
  ml: 'Malayalam',
  pa: 'Punjabi',
  ur: 'Urdu',
  or: 'Odia',
  as: 'Assamese',
  sa: 'Sanskrit',
};

export const LANG_CODES = Object.keys(LANG_CODE_TO_NAME) as LangCode[];

// Lower-cased aliases the auto-detector will accept for each LangCode.
// Both the short ISO-ish code and the English language name are matched.
const LANG_ALIASES: Record<LangCode, string[]> = LANG_CODES.reduce((acc, lc) => {
  acc[lc] = [lc, LANG_CODE_TO_NAME[lc].toLowerCase()];
  return acc;
}, {} as Record<LangCode, string[]>);

const SOURCE_HEADER_ALIASES = ['en', 'english', 'eng', 'source'];

export interface ColumnRef {
  header: string;       // raw header text from the sheet
  index: number;        // 0-based index in the AOA row
}

export interface SheetPlan {
  name: string;
  eligible: boolean;
  ineligibleReason?: string;
  included: boolean;                                          // user toggle (default = eligible)
  headerRowIdx: number;                                       // 0-based
  rowCount: number;                                           // data rows below the header
  populatedSourceCount: number;                               // rows where source col has non-empty content
  totalRows: number;                                          // including the header
  sourceCol: ColumnRef | null;
  existingTargets: Partial<Record<LangCode, ColumnRef>>;
  filledCounts: Partial<Record<LangCode, number>>;
  // Per-sheet target languages — initialised from defaultLanguagePlans in the wizard,
  // then user-mutable via per-sheet chips. Estimate / run use this, NOT the global plan.
  enabledLangs: LangCode[];
}

export interface LanguagePlan {
  code: LangCode;
  name: Language;
  enabled: boolean;
}

export type JobStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface Cell {
  sheet: string;
  rowIdx: number;       // index into the (post-splice) AOA, 0-based
  lang: LangCode;
  sourceText: string;
  rowContext: string;   // JSON of non-language original-header columns
  targetIdx: number;    // post-splice column index in aoa[rowIdx]
  status: JobStatus;
  error?: string;
  result?: string;
}

export interface RunOptions {
  skipFilled: boolean;
  concurrency: number;
  grade: GradeLevel;
  subject: Subject;
}

export type Phase = 'upload' | 'review' | 'running' | 'paused' | 'done';

function normalizeHeader(s: any): string {
  return String(s ?? '').trim().toLowerCase();
}

function isNonEmptyString(v: any): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Find the most likely header row: the first row with at least 3 non-empty
 * cells. Falls back to row 0 if no row meets the bar (handles tiny sheets).
 */
function findHeaderRowIdx(aoa: any[][]): number {
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    const row = aoa[i] || [];
    const nonEmpty = row.filter(c => isNonEmptyString(c)).length;
    if (nonEmpty >= 3) return i;
  }
  return 0;
}

function findColumn(headers: string[], aliases: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    if (aliases.includes(headers[i])) return i;
  }
  return -1;
}

/**
 * Inspect one sheet of a workbook and produce a SheetPlan.
 * Eligible = has a recognisable English source column.
 */
export function detectSheetPlan(wb: XLSX.WorkBook, sheetName: string): SheetPlan {
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' });
  const totalRows = aoa.length;
  const headerRowIdx = findHeaderRowIdx(aoa);
  const rawHeaders = (aoa[headerRowIdx] || []).map((h: any) => String(h ?? ''));
  const headers = rawHeaders.map(normalizeHeader);

  const rowCount = Math.max(0, totalRows - headerRowIdx - 1);

  const srcIdx = findColumn(headers, SOURCE_HEADER_ALIASES);
  if (srcIdx === -1) {
    return {
      name: sheetName,
      eligible: false,
      ineligibleReason: 'no `en` column',
      included: false,
      headerRowIdx,
      rowCount,
      populatedSourceCount: 0,
      totalRows,
      sourceCol: null,
      existingTargets: {},
      filledCounts: {},
      enabledLangs: [],
    };
  }

  // Count rows where the source column actually has English content.
  // The estimate, ETA, and per-language counts are all derived from this — NOT
  // from `rowCount`, which often includes hundreds of trailing blank rows.
  let populatedSourceCount = 0;
  for (let r = headerRowIdx + 1; r < totalRows; r++) {
    if (isNonEmptyString(aoa[r]?.[srcIdx])) populatedSourceCount++;
  }

  const existingTargets: Partial<Record<LangCode, ColumnRef>> = {};
  const filledCounts: Partial<Record<LangCode, number>> = {};

  for (const lc of LANG_CODES) {
    const idx = findColumn(headers, LANG_ALIASES[lc]);
    if (idx === -1 || idx === srcIdx) continue;
    existingTargets[lc] = { header: rawHeaders[idx], index: idx };

    // Count rows where TARGET col is filled AND source col is populated. Empty
    // source rows aren't part of the work pool, so they shouldn't inflate the
    // "filled" denominator either.
    let filled = 0;
    for (let r = headerRowIdx + 1; r < totalRows; r++) {
      if (!isNonEmptyString(aoa[r]?.[srcIdx])) continue;
      if (isNonEmptyString(aoa[r]?.[idx])) filled++;
    }
    filledCounts[lc] = filled;
  }

  return {
    name: sheetName,
    eligible: true,
    included: true,
    headerRowIdx,
    rowCount,
    populatedSourceCount,
    totalRows,
    sourceCol: { header: rawHeaders[srcIdx], index: srcIdx },
    existingTargets,
    filledCounts,
    enabledLangs: [],   // populated by the wizard from defaultLanguagePlans
  };
}

/**
 * Inspect every sheet in a workbook. Order matches `wb.SheetNames`.
 */
export function detectAllSheets(wb: XLSX.WorkBook): SheetPlan[] {
  return wb.SheetNames.map(name => detectSheetPlan(wb, name));
}

/**
 * Default-tick languages that already have a target column in at least one
 * eligible-and-included sheet.
 */
export function defaultLanguagePlans(sheetPlans: SheetPlan[]): LanguagePlan[] {
  const present = new Set<LangCode>();
  for (const sp of sheetPlans) {
    if (!sp.eligible || !sp.included) continue;
    for (const lc of LANG_CODES) {
      if (sp.existingTargets[lc]) present.add(lc);
    }
  }
  return LANG_CODES.map(code => ({
    code,
    name: LANG_CODE_TO_NAME[code],
    enabled: present.has(code),
  }));
}

/**
 * Apply all required column splices to the in-memory AOA for a single sheet,
 * mutate-in-place. Returns:
 *   - resolvedTargets[lang] = post-splice column index for each enabled lang
 *   - sourcePostSpliceIdx   = post-splice column index for the source column
 *   - originalToPostSplice  = function mapping original-header column index
 *                             to its post-splice index (used for rowContext)
 *
 * Strategy: collect all "missing" languages that need a new column. Insert them
 * all to the right of the rightmost current language column (or right of the
 * source column if none). Sort insertion indices descending so each splice
 * doesn't shift earlier insertion points.
 */
export interface SpliceResult {
  resolvedTargets: Partial<Record<LangCode, number>>;
  sourcePostSpliceIdx: number;
  originalToPostSplice: (origIdx: number) => number;
  insertedHeaders: { langCode: LangCode; index: number }[]; // post-splice indices
}

export function applySplicesForSheet(
  aoa: any[][],
  plan: SheetPlan,
  enabledLangs: LangCode[],
): SpliceResult {
  if (!plan.sourceCol) {
    return {
      resolvedTargets: {},
      sourcePostSpliceIdx: -1,
      originalToPostSplice: (i) => i,
      insertedHeaders: [],
    };
  }

  // Determine the anchor: rightmost existing language column, or source col.
  const existingLangIndices: number[] = [];
  for (const lc of LANG_CODES) {
    const ref = plan.existingTargets[lc];
    if (ref) existingLangIndices.push(ref.index);
  }
  const anchorOrigIdx = existingLangIndices.length > 0
    ? Math.max(...existingLangIndices)
    : plan.sourceCol.index;

  // Build the list of langs that need NEW columns.
  const missingLangs: LangCode[] = enabledLangs.filter(lc => !plan.existingTargets[lc]);

  // Insertion plan: each missing lang gets inserted at the same anchor position
  // (anchorOrigIdx + 1), but processed right-to-left so they end up in
  // enabledLangs order to the right of the anchor.
  // For simplicity we splice them all at anchorOrigIdx + 1, one per call,
  // working from the LAST missing lang back to the first; this preserves the
  // list order in the final layout.
  const newLangsToInsert = [...missingLangs];
  // We want the inserted columns to appear in enabledLangs order from left to
  // right. Inserting one-by-one at the same index in REVERSE order achieves
  // that (each new splice pushes prior inserts to the right).
  const insertPosition = anchorOrigIdx + 1;
  const insertedHeaders: { langCode: LangCode; index: number }[] = [];

  for (let r = 0; r < aoa.length; r++) {
    if (!aoa[r]) aoa[r] = [];
    for (let i = newLangsToInsert.length - 1; i >= 0; i--) {
      const lc = newLangsToInsert[i];
      const headerLabel = `${lc} (${LANG_CODE_TO_NAME[lc]})`;
      if (r === plan.headerRowIdx) {
        aoa[r].splice(insertPosition, 0, headerLabel);
      } else {
        aoa[r].splice(insertPosition, 0, '');
      }
    }
  }

  // After splicing, the columns at [insertPosition .. insertPosition + missingLangs.length - 1]
  // hold the new lang columns IN newLangsToInsert ORDER.
  for (let i = 0; i < newLangsToInsert.length; i++) {
    insertedHeaders.push({
      langCode: newLangsToInsert[i],
      index: insertPosition + i,
    });
  }

  // Build the original-index -> post-splice-index mapping.
  // Each original column at origIdx shifts right by the number of inserts that
  // happened at positions <= origIdx (i.e. insertPosition <= origIdx).
  const totalInserts = newLangsToInsert.length;
  const originalToPostSplice = (origIdx: number): number => {
    if (origIdx < insertPosition) return origIdx;
    return origIdx + totalInserts;
  };

  // Resolve the post-splice index for every enabled language.
  const resolvedTargets: Partial<Record<LangCode, number>> = {};
  for (const lc of enabledLangs) {
    const existing = plan.existingTargets[lc];
    if (existing) {
      resolvedTargets[lc] = originalToPostSplice(existing.index);
    } else {
      // Find which inserted-header entry matches this lang.
      const inserted = insertedHeaders.find(h => h.langCode === lc);
      if (inserted) resolvedTargets[lc] = inserted.index;
    }
  }

  const sourcePostSpliceIdx = originalToPostSplice(plan.sourceCol.index);

  return {
    resolvedTargets,
    sourcePostSpliceIdx,
    originalToPostSplice,
    insertedHeaders,
  };
}

/**
 * Build the cell list for a single (post-splice) sheet's AOA.
 * Caller is responsible for splicing FIRST and passing the splice result.
 */
export function buildCellsForSheet(
  aoa: any[][],
  plan: SheetPlan,
  enabledLangs: LangCode[],
  spliceResult: SpliceResult,
  options: { skipFilled: boolean },
): Cell[] {
  const cells: Cell[] = [];
  if (!plan.sourceCol || spliceResult.sourcePostSpliceIdx === -1) return cells;

  const sourceIdx = spliceResult.sourcePostSpliceIdx;
  const headerLabel = plan.sourceCol.header;

  // Collect language-column indices (post-splice) so we can EXCLUDE them from row context.
  const languageColIndices = new Set<number>();
  for (const idx of Object.values(spliceResult.resolvedTargets)) {
    if (typeof idx === 'number') languageColIndices.add(idx);
  }
  // Also exclude pre-existing language columns even if not selected this run.
  for (const lc of LANG_CODES) {
    const existing = plan.existingTargets[lc];
    if (existing) languageColIndices.add(spliceResult.originalToPostSplice(existing.index));
  }

  for (let r = plan.headerRowIdx + 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row) continue;
    const src = row[sourceIdx];
    if (!isNonEmptyString(src)) continue;

    // Build row context: every non-language original-header column with a value.
    const rowContextObj: Record<string, any> = {};
    for (let c = 0; c < (aoa[plan.headerRowIdx] || []).length; c++) {
      if (languageColIndices.has(c)) continue;
      if (c === sourceIdx) continue;
      const val = row[c];
      if (isNonEmptyString(val)) rowContextObj[String(aoa[plan.headerRowIdx][c])] = val;
    }
    const rowContext = JSON.stringify(rowContextObj);

    for (const lc of enabledLangs) {
      const targetIdx = spliceResult.resolvedTargets[lc];
      if (typeof targetIdx !== 'number') continue;

      const existingValue = row[targetIdx];
      if (options.skipFilled && isNonEmptyString(existingValue)) {
        cells.push({
          sheet: plan.name,
          rowIdx: r,
          lang: lc,
          sourceText: src,
          rowContext,
          targetIdx,
          status: 'skipped',
        });
        continue;
      }

      cells.push({
        sheet: plan.name,
        rowIdx: r,
        lang: lc,
        sourceText: String(src),
        rowContext,
        targetIdx,
        status: 'pending',
      });
    }
  }

  // Surface a virtual "header row" entry just for the headers under the
  // contentType field — actually, no, we feed sourceCol.header as contentType
  // in the worker. Nothing else to do.
  void headerLabel;

  return cells;
}

/**
 * Aggregate counts for the review-step estimate.
 *
 * Uses per-sheet `enabledLangs` (NOT the global LanguagePlan list) and
 * `populatedSourceCount` (NOT total rowCount) so the number reflects only
 * cells we'd actually try to translate.
 */
export function estimateCells(
  sheetPlans: SheetPlan[],
  options: { skipFilled: boolean },
): { total: number; bySheet: Record<string, number> } {
  const bySheet: Record<string, number> = {};
  let total = 0;

  for (const sp of sheetPlans) {
    if (!sp.eligible || !sp.included || !sp.sourceCol) {
      bySheet[sp.name] = 0;
      continue;
    }
    let count = 0;
    const pool = sp.populatedSourceCount;
    for (const lc of sp.enabledLangs) {
      const existing = sp.existingTargets[lc];
      if (existing && options.skipFilled) {
        const filled = sp.filledCounts[lc] || 0;
        count += Math.max(0, pool - filled);
      } else {
        count += pool;
      }
    }
    bySheet[sp.name] = count;
    total += count;
  }
  return { total, bySheet };
}
