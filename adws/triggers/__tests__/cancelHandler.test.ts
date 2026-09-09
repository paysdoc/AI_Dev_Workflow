import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Platform, type RepoIdentifier } from '../../providers/types';
import type { LaunchBoundary } from '../../core';

// Mock all external dependencies before importing the module under test
vi.mock('../../core/workflowCommentParsing', () => ({
  extractAdwIdFromComment: vi.fn(),
}));
vi.mock('../../core/stateHelpers', () => ({
  findOrchestratorStatePath: vi.fn(),
  isProcessAlive: vi.fn(),
  createExecutionState: vi.fn(),
  completeExecution: vi.fn(),
  isAgentProcessRunning: vi.fn(),
}));
vi.mock('../../core/config', () => ({
  AGENTS_STATE_DIR: '/mock/agents',
}));

const mockRemoveWorktreesForIssue = vi.hoisted(() => vi.fn());
vi.mock('../../github/gitContextFactory', () => ({
  gitContextForSync: vi.fn().mockReturnValue({ removeWorktreesForIssue: mockRemoveWorktreesForIssue }),
}));

vi.mock('../../adwClearComments', () => ({
  clearIssueComments: vi.fn(),
}));
vi.mock('../../core/logger', () => ({
  log: vi.fn(),
}));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    rmSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import { handleCancelDirective, type MutableProcessedSets } from '../cancelHandler';
import { extractAdwIdFromComment } from '../../core/workflowCommentParsing';
import { findOrchestratorStatePath, isProcessAlive } from '../../core/stateHelpers';
import { clearIssueComments } from '../../adwClearComments';
import * as fs from 'fs';

const mockExtractAdwId = vi.mocked(extractAdwIdFromComment);
const mockFindOrchestratorStatePath = vi.mocked(findOrchestratorStatePath);
const mockIsProcessAlive = vi.mocked(isProcessAlive);
const mockClearIssueComments = vi.mocked(clearIssueComments);
const mockRmSync = vi.mocked(fs.rmSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);

const repoInfo: RepoIdentifier = { owner: 'test-owner', repo: 'test-repo', platform: Platform.GitHub };
const fakeTracker = { fetchComments: vi.fn(), getIssueTitle: vi.fn(), deleteComment: vi.fn() };
const boundary = { repoId: repoInfo, providers: { issueTracker: fakeTracker } } as unknown as LaunchBoundary;

beforeEach(() => {
  vi.clearAllMocks();
  mockRemoveWorktreesForIssue.mockReturnValue(0);
  mockClearIssueComments.mockReturnValue({ total: 0, deleted: 0, failed: 0, issueTitle: '(unknown)' });
  mockIsProcessAlive.mockReturnValue(false);
  mockFindOrchestratorStatePath.mockReturnValue(null);
});

describe('handleCancelDirective', () => {
  it('returns true on successful completion', () => {
    mockExtractAdwId.mockReturnValue(null);

    const result = handleCancelDirective(42, [], boundary);

    expect(result).toBe(true);
  });

  it('extracts adwIds from all comments', () => {
    const comments = [{ body: 'comment-1' }, { body: 'comment-2' }, { body: 'comment-3' }];
    mockExtractAdwId.mockReturnValue(null);

    handleCancelDirective(42, comments, boundary);

    expect(mockExtractAdwId).toHaveBeenCalledTimes(3);
    expect(mockExtractAdwId).toHaveBeenCalledWith('comment-1');
    expect(mockExtractAdwId).toHaveBeenCalledWith('comment-2');
    expect(mockExtractAdwId).toHaveBeenCalledWith('comment-3');
  });

  it('attempts process kill for each extracted adwId', () => {
    const comments = [{ body: 'c1' }, { body: 'c2' }];
    mockExtractAdwId
      .mockReturnValueOnce('adwid-1')
      .mockReturnValueOnce('adwid-2');
    mockFindOrchestratorStatePath
      .mockReturnValueOnce('/mock/agents/adwid-1/orch')
      .mockReturnValueOnce('/mock/agents/adwid-2/orch');
    mockReadFileSync.mockReturnValue(JSON.stringify({ pid: 1234 }));
    mockIsProcessAlive.mockReturnValue(false);

    handleCancelDirective(42, comments, boundary);

    expect(mockFindOrchestratorStatePath).toHaveBeenCalledWith('adwid-1');
    expect(mockFindOrchestratorStatePath).toHaveBeenCalledWith('adwid-2');
  });

  it('sends SIGTERM when orchestrator process is alive', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    mockExtractAdwId.mockReturnValue('adwid-1');
    mockFindOrchestratorStatePath.mockReturnValue('/mock/agents/adwid-1/orch');
    mockReadFileSync.mockImplementation(() => JSON.stringify({ pid: 9999 }));
    // First call: process is alive → send SIGTERM; second call: dead after SIGTERM → skip SIGKILL
    mockIsProcessAlive.mockReturnValueOnce(true).mockReturnValueOnce(false);

    handleCancelDirective(42, [{ body: 'c1' }], boundary);

    expect(killSpy).toHaveBeenCalledWith(9999, 'SIGTERM');
    killSpy.mockRestore();
  });

  it('calls removeWorktreesForIssue on the gitContext with correct issueNumber', () => {
    mockExtractAdwId.mockReturnValue(null);

    handleCancelDirective(42, [], boundary, '/some/cwd');

    expect(mockRemoveWorktreesForIssue).toHaveBeenCalledWith(42);
  });

  it('calls removeWorktreesForIssue on the gitContext when no cwd provided', () => {
    mockExtractAdwId.mockReturnValue(null);

    handleCancelDirective(42, [], boundary);

    expect(mockRemoveWorktreesForIssue).toHaveBeenCalledWith(42);
  });

  it('deletes agents/{adwId}/ directories for all extracted adwIds', () => {
    const comments = [{ body: 'c1' }, { body: 'c2' }];
    mockExtractAdwId
      .mockReturnValueOnce('adwid-1')
      .mockReturnValueOnce('adwid-2');
    mockFindOrchestratorStatePath.mockReturnValue(null);

    handleCancelDirective(42, comments, boundary);

    expect(mockRmSync).toHaveBeenCalledWith('/mock/agents/adwid-1', { recursive: true, force: true });
    expect(mockRmSync).toHaveBeenCalledWith('/mock/agents/adwid-2', { recursive: true, force: true });
  });

  it('calls clearIssueComments with the issue number and the boundary\'s issue tracker', () => {
    mockExtractAdwId.mockReturnValue(null);

    handleCancelDirective(42, [], boundary);

    expect(mockClearIssueComments).toHaveBeenCalledWith(42, fakeTracker);
  });

  it('removes issue from processedSets when provided', () => {
    mockExtractAdwId.mockReturnValue(null);
    const processedSets: MutableProcessedSets = {
      spawns: new Set([42, 99]),
    };

    handleCancelDirective(42, [], boundary, undefined, processedSets);

    expect(processedSets.spawns.has(42)).toBe(false);
    // Other entries untouched
    expect(processedSets.spawns.has(99)).toBe(true);
  });

  it('does not touch processedSets when not provided', () => {
    mockExtractAdwId.mockReturnValue(null);

    // Should not throw when processedSets is undefined
    expect(() => handleCancelDirective(42, [], boundary)).not.toThrow();
  });

  it('handles no adwIds gracefully (still clears comments and worktrees)', () => {
    mockExtractAdwId.mockReturnValue(null);

    handleCancelDirective(42, [{ body: 'some comment' }], boundary);

    expect(mockRemoveWorktreesForIssue).toHaveBeenCalled();
    expect(mockClearIssueComments).toHaveBeenCalled();
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it('handles missing state files gracefully and continues to next adwId', () => {
    const comments = [{ body: 'c1' }, { body: 'c2' }];
    mockExtractAdwId
      .mockReturnValueOnce('adwid-1')
      .mockReturnValueOnce('adwid-2');
    // adwid-1: state path found but readFileSync throws
    mockFindOrchestratorStatePath
      .mockReturnValueOnce('/mock/agents/adwid-1/orch')
      .mockReturnValueOnce(null);
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    // Should complete without throwing
    expect(() => handleCancelDirective(42, comments, boundary)).not.toThrow();
    // Both adwIds still had rmSync called
    expect(mockRmSync).toHaveBeenCalledWith('/mock/agents/adwid-1', { recursive: true, force: true });
    expect(mockRmSync).toHaveBeenCalledWith('/mock/agents/adwid-2', { recursive: true, force: true });
  });

  it('deduplicates adwIds extracted from multiple comments', () => {
    const comments = [{ body: 'c1' }, { body: 'c2' }, { body: 'c3' }];
    mockExtractAdwId.mockReturnValue('same-adwid'); // all return same id
    mockFindOrchestratorStatePath.mockReturnValue(null);

    handleCancelDirective(42, comments, boundary);

    // rmSync called only once despite three comments returning the same adwId
    expect(mockRmSync).toHaveBeenCalledTimes(1);
    expect(mockRmSync).toHaveBeenCalledWith('/mock/agents/same-adwid', { recursive: true, force: true });
  });
});
