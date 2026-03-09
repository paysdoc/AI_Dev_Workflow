import { describe, it, expect, vi } from 'vitest';

vi.mock('../utils', () => ({
  log: vi.fn(),
}));

import { CostCommitQueue } from '../costCommitQueue';
import { log } from '../utils';

describe('CostCommitQueue', () => {
  it('executes operations serially (second starts only after first completes)', async () => {
    const queue = new CostCommitQueue();
    const order: number[] = [];

    const op1 = queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push(1);
    });

    const op2 = queue.enqueue(async () => {
      order.push(2);
    });

    await op2;

    expect(order).toEqual([1, 2]);
    await op1;
  });

  it('does not block subsequent operations when one fails', async () => {
    const queue = new CostCommitQueue();
    const order: number[] = [];

    await queue.enqueue(async () => {
      order.push(1);
      throw new Error('op1 failed');
    });

    await queue.enqueue(async () => {
      order.push(2);
    });

    expect(order).toEqual([1, 2]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('op1 failed'), 'error');
  });

  it('executes multiple concurrent enqueues in enqueue order', async () => {
    const queue = new CostCommitQueue();
    const order: number[] = [];

    const promises = [1, 2, 3, 4, 5].map((n) =>
      queue.enqueue(async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push(n);
      }),
    );

    await Promise.all(promises);

    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  it('resolves the returned promise when the operation completes', async () => {
    const queue = new CostCommitQueue();
    let completed = false;

    const promise = queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 20));
      completed = true;
    });

    expect(completed).toBe(false);
    await promise;
    expect(completed).toBe(true);
  });

  it('handles async operations correctly', async () => {
    const queue = new CostCommitQueue();
    const results: string[] = [];

    await queue.enqueue(async () => {
      const value = await Promise.resolve('async-value');
      results.push(value);
    });

    expect(results).toEqual(['async-value']);
  });
});
