/**
 * Async operation queue that serializes all cost-related git operations.
 *
 * Only one operation runs at a time, eliminating concurrency race conditions
 * that caused issues #76, #83, #85, and #107.
 */

import { log } from '../core/logger';

export class CostCommitQueue {
  private chain: Promise<void> = Promise.resolve();

  /** Appends an operation to the queue. Operations execute serially. */
  enqueue(operation: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(operation).catch((error) => {
      log(`CostCommitQueue operation failed: ${error}`, 'error');
    });
    return this.chain;
  }
}

export const costCommitQueue = new CostCommitQueue();
