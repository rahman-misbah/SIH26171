// §6.7 / §15 (M9): "the assembler waits only for images it will actually
// send" -- process images in priority order, at most `limit` at once, and
// stop starting new ones once `budget` have come back sendable. Written
// before the implementation.

import { describe, expect, it } from 'vitest';
import { runWithBudget } from '@/dom/budgetQueue';

function deferred() {
  let resolve!: (ok: boolean) => void;
  const promise = new Promise<boolean>((r) => (resolve = r));
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('runWithBudget', () => {
  it('stops once the budget is met and returns the items it never started', async () => {
    const started: number[] = [];
    const skipped = await runWithBudget([1, 2, 3, 4, 5], { limit: 3, budget: 2 }, async (n) => {
      started.push(n);
      return true;
    });
    expect(started).toEqual([1, 2]);
    expect(skipped).toEqual([3, 4, 5]);
  });

  it('replaces a failed item with the next one, in order', async () => {
    const started: number[] = [];
    const skipped = await runWithBudget([1, 2, 3, 4], { limit: 3, budget: 2 }, async (n) => {
      started.push(n);
      return n !== 1; // 1 fails
    });
    expect(started).toEqual([1, 2, 3]);
    expect(skipped).toEqual([4]);
  });

  it('never has more than min(limit, budget - ok) in flight', async () => {
    const gates = [deferred(), deferred(), deferred(), deferred()];
    let inFlight = 0;
    let peak = 0;
    const run = runWithBudget([0, 1, 2, 3], { limit: 3, budget: 2 }, async (i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      const ok = await gates[i]!.promise;
      inFlight--;
      return ok;
    });
    await tick();
    expect(peak).toBe(2);
    gates[0]!.resolve(false);
    await tick();
    gates[1]!.resolve(true);
    gates[2]!.resolve(true);
    expect(await run).toEqual([3]);
  });

  it('a budget of 0 starts nothing', async () => {
    const skipped = await runWithBudget([1, 2], { limit: 3, budget: 0 }, async () => true);
    expect(skipped).toEqual([1, 2]);
  });

  it('processes everything when the budget is never reached', async () => {
    const skipped = await runWithBudget([1, 2, 3], { limit: 2, budget: 5 }, async () => false);
    expect(skipped).toEqual([]);
  });
});
