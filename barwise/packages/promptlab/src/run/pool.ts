/**
 * The bounded worker pool the concurrent sweep schedules on
 * (docs/specs/eval-run-concurrency.spec.md). Its own module because it
 * is pure and its one interesting property -- results land by task
 * index, never by completion order -- is exactly the kind of claim a
 * mock-client test walks past, so it is pinned here on fake tasks.
 */

/** A promise plus the handle that settles it. */
export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Run every task with at most `limit` in flight, returning results in
 * task order. `limit: 1` degenerates to a plain sequential loop. A
 * rejected task rejects the whole pool, matching what `Promise.all`
 * and the previous serial loop both did -- the sweep's tasks do not
 * reject in normal operation (a failed call is a failed CaseRun, not a
 * throw).
 */
export async function boundedAll<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`concurrency must be a positive integer, got ${limit}.`);
  }
  const results = new Array<T>(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]!();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, () => worker()),
  );
  return results;
}
