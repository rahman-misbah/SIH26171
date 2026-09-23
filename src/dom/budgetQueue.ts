// §6.7 / §15 (M9): the content script processes images in §6.7 priority
// order but stops once the backend's per-request image limit (the send
// budget from imageLookup) is met, so an observation never waits on images
// §14.3 would drop anyway. At most `limit` run at once, and never more than
// are still needed (budget - ready): a failed image is replaced by the next
// one in order.

export async function runWithBudget<T>(
  items: T[],
  options: { limit: number; budget: number },
  fn: (item: T) => Promise<boolean>, // resolves true when the item is sendable; must not reject
): Promise<T[]> {
  let ok = 0;
  let next = 0;
  const inFlight = new Set<Promise<void>>();

  while (next < items.length && ok < options.budget) {
    if (inFlight.size >= options.limit || ok + inFlight.size >= options.budget) {
      await Promise.race(inFlight);
      continue;
    }
    const item = items[next++]!;
    const run: Promise<void> = fn(item).then((sendable) => {
      if (sendable) ok++;
      inFlight.delete(run);
    });
    inFlight.add(run);
  }
  await Promise.all(inFlight);
  return items.slice(next);
}
