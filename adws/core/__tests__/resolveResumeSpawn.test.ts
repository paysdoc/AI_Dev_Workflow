import { describe, it, expect } from 'vitest';
import { resolveResumeSpawn, DEFAULT_RESUME_SCRIPT } from '../resolveResumeSpawn';
import type { AgentState } from '../../types/agentTypes';

function makeState(overrides: Partial<AgentState> & { adwId: string; issueNumber: number | null }): AgentState {
  return {
    agentName: 'sdlc-orchestrator',
    execution: { status: 'completed', startedAt: '', completedAt: '' },
    ...overrides,
  } as AgentState;
}

describe('resolveResumeSpawn', () => {
  describe('script routing', () => {
    it('routes a PR-review-owned state to adwPrReview', () => {
      const state = makeState({ adwId: 'l1zzfx-prr', issueNumber: 721, orchestratorScript: 'adws/adwPrReview.tsx' });
      const result = resolveResumeSpawn(state);
      expect(result.script).toBe('adws/adwPrReview.tsx');
    });

    it('routes an SDLC-owned state to adwSdlc', () => {
      const state = makeState({ adwId: 'abc123-sdlc', issueNumber: 500, orchestratorScript: 'adws/adwSdlc.tsx' });
      const result = resolveResumeSpawn(state);
      expect(result.script).toBe('adws/adwSdlc.tsx');
    });

    it('routes a third orchestrator (adwChore) correctly', () => {
      const state = makeState({ adwId: 'xyz789-chore', issueNumber: 300, orchestratorScript: 'adws/adwChore.tsx' });
      const result = resolveResumeSpawn(state);
      expect(result.script).toBe('adws/adwChore.tsx');
    });

    it('defaults to SDLC when orchestratorScript is absent', () => {
      const state = makeState({ adwId: 'legacy-id', issueNumber: 42 });
      const result = resolveResumeSpawn(state);
      expect(result.script).toBe(DEFAULT_RESUME_SCRIPT);
      expect(result.script).toBe('adws/adwSdlc.tsx');
    });
  });

  describe('args normalization', () => {
    it('stringifies numeric issueNumber', () => {
      const state = makeState({ adwId: 'rrs-721-prr', issueNumber: 7211, orchestratorScript: 'adws/adwPrReview.tsx' });
      const result = resolveResumeSpawn(state);
      expect(result.args[0]).toBe('7211');
      expect(typeof result.args[0]).toBe('string');
    });

    it('passes adwId through verbatim', () => {
      const state = makeState({ adwId: 'rrs-721-prr', issueNumber: 7211, orchestratorScript: 'adws/adwPrReview.tsx' });
      const result = resolveResumeSpawn(state);
      expect(result.args[1]).toBe('rrs-721-prr');
    });

    it('produces exactly two args [issueNumber, adwId]', () => {
      const state = makeState({ adwId: 'rrs-721-sdlc', issueNumber: 7212, orchestratorScript: 'adws/adwSdlc.tsx' });
      const result = resolveResumeSpawn(state);
      expect(result.args).toHaveLength(2);
      expect(result.args[0]).toBe('7212');
      expect(result.args[1]).toBe('rrs-721-sdlc');
    });

    it('handles null issueNumber by stringifying to "null"', () => {
      const state = makeState({ adwId: 'no-issue', issueNumber: null });
      const result = resolveResumeSpawn(state);
      expect(result.args[0]).toBe('null');
      expect(result.args[1]).toBe('no-issue');
    });
  });
});
