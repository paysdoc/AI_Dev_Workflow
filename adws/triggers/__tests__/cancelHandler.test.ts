import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RepoInfo } from '../../github/githubApi';

// Mock all external dependencies before importing the module under test
vi.mock('../../core/workflowCommentParsing', () => ({
  extractAdwIdFromComment: vi.fn(),
}));
vi.mock('../../core/stateHelpers', () => ({
  findOrchestratorStatePath: vi.fn(),
  isProcessAlive: vi.fn(),
}));
vi.mock('../../core/config', () => ({
  AGENTS_STATE_DIR: '/mock/agents',
}));
vi.mock('../../vcs/worktreeCleanup', () => ({
  removeWorktreesForIssue: vi.fn(),
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
import { removeWorktreesForIssue } from '../../vcs/worktreeCleanup';
import { clearIssueComments } from '../../adwClearComments';
import * as fs from 'fs';

const mockExtractAdwId = vi.mocked(extractAdwIdFromComment);
const mockFindOrchestratorStatePath = vi.mocked(findOrchestratorStatePath);
const mockIsProcessAlive = vi.mocked(isProcessAlive);
const mockRemoveWorktreesForIssue = vi.mocked(removeWorktreesForIssue);
const mockClearIssueComments = vi.mocked(clearIssueComments);
const mockRmSync = vi.mocked(fs.rmSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);

const repoInfo: RepoInfo = { owner: 'test-owner', repo: 'test-repo' };

beforeEach(() => {
  vi.clearAllMocks();
  mockClearIssueComments.mockReturnValue({ total: 0, deleted: 0, failed: 0 });
  mockIsProcessAlive.mockReturnValue(false);
  mockFindOrchestratorStatePath.mockReturnValue(null);
});

describe('handleCancelDirective', () => {
  it('returns true on successful completion', () => {
    mockExtractAdwId.mockReturnValue(null);

    const result = handleCancelDirective(42, [], repoInfo);

    expect(result).toBe(true);
  });

  it('extracts adwIds from all comments', () => {
    const comments = [{ body: 'comment-1' }, { body: 'comment-2' }, { body: 'comment-3' }];
    mockExtractAdwId.mockReturnValue(null);

    handleCancelDirective(42, comments, repoInfo);

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

    handleCancelDirective(42, comments, repoInfo);

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

    handleCancelDirective(42, [{ body: 'c1' }], repoInfo);

    expect(killSpy).toHaveBeenCalledWith(9999, 'SIGTERM');
    killSpy.mockRestore();
  });

  it('calls removeWorktreesForIssue with correct issueNumber and cwd', () => {
    mockExtractAdwId.mockReturnValue(null);

    handleCancelDirective(42, [], repoInfo, '/some/cwd');

    expect(mockRemoveWorktreesForIssue).toHaveBeenCalledWith(42, '/some/cwd');
  });

  it('calls removeWorktreesForIssue with undefined cwd when not provided', () => {
    mockExtractAdwId.mockReturnValue(null);

    handleCancelDirective(42, [], repoInfo);

    expect(mockRemoveWorktreesForIssue).toHaveBeenCalledWith(42, undefined);
  });

  it('deletes agents/{adwId}/ directories for all extracted adwIds', () => {
    const comments = [{ body: 'c1' }, { body: 'c2' }];
    mockExtractAdwId
      .mockReturnValueOnce('adwid-1')
      .mockReturnValueOnce('adwid-2');
    mockFindOrchestratorStatePath.mockReturnValue(null);

    handleCancelDirective(42, comments, repoInfo);

    expect(mockRmSync).toHaveBeenCalledWith('/mock/agents/adwid-1', { recursive: true, force: true });
    expect(mockRmSync).toHaveBeenCalledWith('/mock/agents/adwid-2', { recursive: true, force: true });
  });

  it('calls clearIssueComments with correct issueNumber and repoInfo', () => {
    mockExtractAdwId.mockReturnValue(null);

    handleCancelDirective(42, [], repoInfo);

    expect(mockClearIssueComments).toHaveBeenCalledWith(42, repoInfo);
  });

  it('removes issue from processedSets when provided', () => {
    mockExtractAdwId.mockReturnValue(null);
    const processedSets: MutableProcessedSets = {
      spawns: new Set([42, 99]),
    };

    handleCancelDirective(42, [], repoInfo, undefined, processedSets);

    expect(processedSets.spawns.has(42)).toBe(false);
    // Other entries untouched
    expect(processedSets.spawns.has(99)).toBe(true);
  });

  it('does not touch processedSets when not provided', () => {
    mockExtractAdwId.mockReturnValue(null);

    // Should not throw when processedSets is undefined
    expect(() => handleCancelDirective(42, [], repoInfo)).not.toThrow();
  });

  it('handles no adwIds gracefully (still clears comments and worktrees)', () => {
    mockExtractAdwId.mockReturnValue(null);

    handleCancelDirective(42, [{ body: 'some comment' }], repoInfo);

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
    expect(() => handleCancelDirective(42, comments, repoInfo)).not.toThrow();
    // Both adwIds still had rmSync called
    expect(mockRmSync).toHaveBeenCalledWith('/mock/agents/adwid-1', { recursive: true, force: true });
    expect(mockRmSync).toHaveBeenCalledWith('/mock/agents/adwid-2', { recursive: true, force: true });
  });

  it('deduplicates adwIds extracted from multiple comments', () => {
    const comments = [{ body: 'c1' }, { body: 'c2' }, { body: 'c3' }];
    mockExtractAdwId.mockReturnValue('same-adwid'); // all return same id
    mockFindOrchestratorStatePath.mockReturnValue(null);

    handleCancelDirective(42, comments, repoInfo);

    // rmSync called only once despite three comments returning the same adwId
    expect(mockRmSync).toHaveBeenCalledTimes(1);
    expect(mockRmSync).toHaveBeenCalledWith('/mock/agents/same-adwid', { recursive: true, force: true });
  });
});
