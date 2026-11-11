const WINDOW_MS = 60_000;

/**
 * Sliding one-minute budget of API quota units. `take(cost)` resolves once the request fits in the budget,
 * waiting for older requests to leave the window. Calls are serialized so concurrent callers can't overshoot.
 */
export function createThrottle(
  unitsPerMinute: number,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
) {
  const log: { at: number; cost: number }[] = [];
  // Two queues share one budget: interactive calls never wait behind background work.
  const chains = { fg: Promise.resolve(), bg: Promise.resolve() };
  let waiting = 0;
  let fgWaiting = 0;

  async function admit(cost: number, background: boolean): Promise<void> {
    for (;;) {
      if (background && fgWaiting > 0) {
        await sleep(50);
        continue;
      }
      const t = now();
      while (log.length && log[0].at <= t - WINDOW_MS) log.shift();
      const used = log.reduce((n, e) => n + e.cost, 0);
      // An empty window always admits, so a request costlier than the whole budget still goes through.
      if (!log.length || used + cost <= unitsPerMinute) {
        log.push({ at: t, cost });
        return;
      }
      await sleep(log[0].at + WINDOW_MS - t + 1);
    }
  }

  const take = (cost: number, background = false): Promise<void> => {
    const lane = background ? 'bg' : 'fg';
    waiting++;
    if (!background) fgWaiting++;
    const next = chains[lane]
      .then(() => admit(cost, background))
      .finally(() => {
        waiting--;
        if (!background) fgWaiting--;
      });
    chains[lane] = next.catch(() => {});
    return next;
  };

  /** Units spent in the last 60 s, the budget, and how many calls are queued (Calm is slowing down). */
  take.usage = () => {
    const t = now();
    const used = log.filter((e) => e.at > t - WINDOW_MS).reduce((n, e) => n + e.cost, 0);
    return { used, budget: unitsPerMinute, waiting };
  };
  return take;
}
