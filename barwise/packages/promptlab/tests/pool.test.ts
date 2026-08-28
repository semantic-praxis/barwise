/**
 * The worker pool under the concurrent sweep, pinned on fake tasks
 * because its interesting property -- results by task index, never by
 * completion order -- is exactly what a mock-client test can pass
 * without proving (docs/specs/eval-run-concurrency.spec.md).
 */
import { describe, expect, it } from "vitest";
import { boundedAll, deferred } from "../src/run/pool.js";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("boundedAll", () => {
  it("returns results in task order even when tasks finish in reverse", async () => {
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    const done = boundedAll(
      gates.map((g, i) => async () => {
        await g.promise;
        return i;
      }),
      3,
    );
    // Finish 2, then 1, then 0.
    gates[2]!.resolve();
    await tick();
    gates[1]!.resolve();
    await tick();
    gates[0]!.resolve();
    expect(await done).toEqual([0, 1, 2]);
  });

  it("never runs more tasks than the limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const results = await boundedAll(
      Array.from({ length: 7 }, (_, i) => async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await tick();
        inFlight--;
        return i;
      }),
      2,
    );
    expect(maxInFlight).toBe(2);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("degenerates to a sequential loop at limit 1", async () => {
    const order: string[] = [];
    await boundedAll(
      Array.from({ length: 3 }, (_, i) => async () => {
        order.push(`start ${i}`);
        await tick();
        order.push(`end ${i}`);
      }),
      1,
    );
    expect(order).toEqual(["start 0", "end 0", "start 1", "end 1", "start 2", "end 2"]);
  });

  it("rejects a limit below one before running anything", async () => {
    let ran = false;
    await expect(
      boundedAll([async () => {
        ran = true;
      }], 0),
    ).rejects.toThrow(/positive integer/);
    expect(ran).toBe(false);
  });
});
