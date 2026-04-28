import type {
  Cell,
  LanguagePlan,
  RunOptions,
  SheetPlan,
} from './excelPlan';

const STORAGE_KEY = 'shiksha-anuvad.batch-state.v1';
// Keep cell payloads bounded so the whole serialised state fits the
// localStorage quota (~5 MB on most browsers).
const MAX_CELL_TEXT_BYTES = 8000;

export interface PersistedState {
  fileHash: string;
  fileName: string;
  savedAt: number;                   // ms epoch
  sheetPlans: SheetPlan[];
  languagePlans: LanguagePlan[];
  options: RunOptions;
  cells: Cell[];
  completedCount: number;
  errorCount: number;
}

/** SHA-256 of the uploaded buffer. Used as the persistence key. */
export async function hashBuffer(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function trimCellForStorage(cell: Cell): Cell {
  const trim = (s: string | undefined) =>
    typeof s === 'string' && s.length > MAX_CELL_TEXT_BYTES
      ? s.slice(0, MAX_CELL_TEXT_BYTES)
      : s;
  return {
    ...cell,
    sourceText: trim(cell.sourceText) || '',
    rowContext: trim(cell.rowContext) || '',
    result: trim(cell.result),
  };
}

export function loadPersistedState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed?.fileHash || !Array.isArray(parsed.cells)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePersistedState(state: Omit<PersistedState, 'savedAt'>): void {
  try {
    const payload: PersistedState = {
      ...state,
      cells: state.cells.map(trimCellForStorage),
      savedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    // QuotaExceededError or serialisation failure — drop the save silently;
    // the run remains valid in memory.
    console.warn('[persistence] save failed:', err);
  }
}

export function clearPersistedState(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}
