/**
 * Run async jobs with a concurrency cap. Workers pull from a shared cursor so
 * faster jobs don't wait for slower batchmates. onSettled fires once per job
 * (in completion order, not input order) — caller uses it for progress.
 *
 * Aborts: when the signal fires, no NEW jobs are started, but in-flight calls
 * complete naturally (they may also accept the signal themselves and short-
 * circuit). Already-completed results are kept.
 */
export async function runWithConcurrency<T>(
  count: number,
  concurrency: number,
  worker: (index: number, signal?: AbortSignal) => Promise<T>,
  onSettled?: (index: number, result: T | Error) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (count <= 0) return;

  let cursor = 0;
  const next = (): number => cursor++;

  const laneCount = Math.min(concurrency, count);
  const lanes: Promise<void>[] = [];
  for (let i = 0; i < laneCount; i++) {
    lanes.push((async () => {
      while (true) {
        if (signal?.aborted) return;
        const idx = next();
        if (idx >= count) return;
        try {
          const result = await worker(idx, signal);
          onSettled?.(idx, result);
        } catch (err) {
          onSettled?.(idx, err as Error);
        }
      }
    })());
  }

  await Promise.all(lanes);
}
