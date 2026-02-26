import { describe, it, expect, beforeEach } from 'vitest';
import {
  shouldTriggerPrReview,
  resetPrReviewTriggers,
  getPrReviewTriggersMap,
} from '../triggers/trigger_webhook';

describe('PR review deduplication', () => {
  beforeEach(() => {
    resetPrReviewTriggers();
  });

  it('shouldTriggerPrReview returns true for first trigger of a PR', () => {
    expect(shouldTriggerPrReview(1)).toBe(true);
  });

  it('shouldTriggerPrReview returns false for duplicate trigger within cooldown', () => {
    expect(shouldTriggerPrReview(42)).toBe(true);
    expect(shouldTriggerPrReview(42)).toBe(false);
  });

  it('shouldTriggerPrReview returns true for different PR numbers', () => {
    expect(shouldTriggerPrReview(1)).toBe(true);
    expect(shouldTriggerPrReview(2)).toBe(true);
    expect(shouldTriggerPrReview(3)).toBe(true);
  });

  it('shouldTriggerPrReview returns true after cooldown expires', () => {
    expect(shouldTriggerPrReview(10)).toBe(true);

    // Simulate cooldown expiry by backdating the map entry
    const map = getPrReviewTriggersMap();
    map.set(10, Date.now() - 61_000);

    expect(shouldTriggerPrReview(10)).toBe(true);
  });

  it('shouldTriggerPrReview deduplicates multiple rapid events for the same PR', () => {
    expect(shouldTriggerPrReview(5)).toBe(true);
    expect(shouldTriggerPrReview(5)).toBe(false);
    expect(shouldTriggerPrReview(5)).toBe(false);
    expect(shouldTriggerPrReview(5)).toBe(false);
  });

  it('deduplication for one PR does not affect a different PR', () => {
    expect(shouldTriggerPrReview(1)).toBe(true);
    expect(shouldTriggerPrReview(1)).toBe(false);
    // Different PR should still trigger
    expect(shouldTriggerPrReview(2)).toBe(true);
  });

  it('resetPrReviewTriggers clears the map', () => {
    shouldTriggerPrReview(1);
    shouldTriggerPrReview(2);

    resetPrReviewTriggers();

    // After reset, the same PRs should trigger again
    expect(shouldTriggerPrReview(1)).toBe(true);
    expect(shouldTriggerPrReview(2)).toBe(true);
  });
});
