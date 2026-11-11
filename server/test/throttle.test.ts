import { describe, expect, it } from 'vitest';
import { createThrottle } from '../src/throttle.ts';

function clock() {
  let t = 0;
  const waits: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      waits.push(ms);
      t += ms;
    },
    waits,
  };
}

describe('createThrottle', () => {
  it('lets requests through while under the per-minute budget', async () => {
    const c = clock();
    const take = createThrottle(100, c.now, c.sleep);
    for (let i = 0; i < 5; i++) await take(20);
    expect(c.waits).toEqual([]);
  });

  it('waits until the oldest units leave the 60 s window', async () => {
    const c = clock();
    const take = createThrottle(100, c.now, c.sleep);
    for (let i = 0; i < 5; i++) await take(20);
    await take(20);
    expect(c.waits.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(60_000);
  });

  it('reports units used in the last minute and whether callers are waiting', async () => {
    const c = clock();
    const t = createThrottle(100, c.now, c.sleep);
    await t(30);
    await t(20);
    expect(t.usage()).toEqual({ used: 50, budget: 100, waiting: 0 });
    c.sleep(61_000);
    expect(t.usage().used).toBe(0);
  });

  it('lets interactive calls pass ahead of queued background work', async () => {
    const c = clock();
    const t = createThrottle(100, c.now, c.sleep);
    const order: string[] = [];
    for (let i = 0; i < 5; i++) await t(20, true);
    const bg = [1, 2, 3].map((i) => t(20, true).then(() => order.push(`bg${i}`)));
    const fg = t(20).then(() => order.push('fg'));
    await Promise.all([...bg, fg]);
    expect(order[0]).toBe('fg');
  });

  it('never deadlocks on a single request costlier than the budget', async () => {
    const c = clock();
    const take = createThrottle(50, c.now, c.sleep);
    await take(60);
    await take(60);
    expect(c.now()).toBeGreaterThanOrEqual(60_000);
  });
});
