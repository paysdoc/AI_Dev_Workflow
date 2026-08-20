import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../github/issueApi', () => ({
  fetchGitHubIssue: vi.fn(),
  commentOnIssue: vi.fn(),
  deleteIssueComment: vi.fn(),
  closeIssue: vi.fn(),
  getIssueState: vi.fn(),
  fetchIssueCommentsRest: vi.fn(),
  fetchIssueLabels: vi.fn(),
  addIssueLabel: vi.fn(),
  createIssue: vi.fn(),
  updateIssueBody: vi.fn(),
  searchOpenIssues: vi.fn(),
  findOpenUpgradeIssue: vi.fn(),
}));

vi.mock('../../../github/labelManager', () => ({
  applyLabel: vi.fn(),
  ensureLabelExists: vi.fn(),
}));

vi.mock('../../../github/projectBoardApi', () => ({
  moveIssueToStatus: vi.fn(),
}));

import { createGitHubIssueTracker } from '../githubIssueTracker';
import { Platform, type RepoIdentifier } from '../../types';
import {
  fetchIssueLabels,
  addIssueLabel,
  createIssue,
  updateIssueBody,
  searchOpenIssues,
  findOpenUpgradeIssue,
} from '../../../github/issueApi';
import { applyLabel, ensureLabelExists } from '../../../github/labelManager';

const REPO_ID: RepoIdentifier = { owner: 'acme', repo: 'widget', platform: Platform.GitHub };
const REPO_INFO = { owner: 'acme', repo: 'widget' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GitHubIssueTracker — new method delegation', () => {
  it('fetchLabels delegates to issueApi.fetchIssueLabels with the bound repoInfo', () => {
    vi.mocked(fetchIssueLabels).mockReturnValue(['adw:bug', 'hitl']);
    const tracker = createGitHubIssueTracker(REPO_ID);

    const result = tracker.fetchLabels(42);

    expect(fetchIssueLabels).toHaveBeenCalledTimes(1);
    expect(fetchIssueLabels).toHaveBeenCalledWith(42, REPO_INFO);
    expect(result).toEqual(['adw:bug', 'hitl']);
  });

  it('addLabel delegates to issueApi.addIssueLabel with the bound repoInfo', () => {
    const tracker = createGitHubIssueTracker(REPO_ID);

    tracker.addLabel(42, 'hitl');

    expect(addIssueLabel).toHaveBeenCalledTimes(1);
    expect(addIssueLabel).toHaveBeenCalledWith(42, 'hitl', REPO_INFO);
  });

  it('applyLabel delegates to labelManager.applyLabel with the bound repoInfo', () => {
    const tracker = createGitHubIssueTracker(REPO_ID);

    tracker.applyLabel(42, 'adw:blocked');

    expect(applyLabel).toHaveBeenCalledTimes(1);
    expect(applyLabel).toHaveBeenCalledWith(42, 'adw:blocked', REPO_INFO);
  });

  it('ensureLabel delegates to labelManager.ensureLabelExists with the bound repoInfo', () => {
    const tracker = createGitHubIssueTracker(REPO_ID);

    tracker.ensureLabel('adw:blocked', 'b60205', 'ADW lane escalated to human (terminal)');

    expect(ensureLabelExists).toHaveBeenCalledTimes(1);
    expect(ensureLabelExists).toHaveBeenCalledWith('adw:blocked', 'b60205', 'ADW lane escalated to human (terminal)', REPO_INFO);
  });

  it('createIssue delegates to issueApi.createIssue and returns its value unchanged', () => {
    vi.mocked(createIssue).mockReturnValue(101);
    const tracker = createGitHubIssueTracker(REPO_ID);

    const result = tracker.createIssue('title', 'body');

    expect(createIssue).toHaveBeenCalledTimes(1);
    expect(createIssue).toHaveBeenCalledWith('title', 'body', REPO_INFO);
    expect(result).toBe(101);
  });

  it('updateIssueBody delegates to issueApi.updateIssueBody with the bound repoInfo', () => {
    const tracker = createGitHubIssueTracker(REPO_ID);

    tracker.updateIssueBody(42, 'new body');

    expect(updateIssueBody).toHaveBeenCalledTimes(1);
    expect(updateIssueBody).toHaveBeenCalledWith(42, 'new body', REPO_INFO);
  });

  it('searchOpenIssues delegates to issueApi.searchOpenIssues and returns its value unchanged', () => {
    const results = [{ number: 7, title: 'docs-bloat: app_docs/foo.md' }];
    vi.mocked(searchOpenIssues).mockReturnValue(results);
    const tracker = createGitHubIssueTracker(REPO_ID);

    const result = tracker.searchOpenIssues('docs-bloat: app_docs/foo.md', 5);

    expect(searchOpenIssues).toHaveBeenCalledTimes(1);
    expect(searchOpenIssues).toHaveBeenCalledWith('docs-bloat: app_docs/foo.md', 5, REPO_INFO);
    expect(result).toEqual(results);
  });

  it('findOpenUpgradeIssue delegates to issueApi.findOpenUpgradeIssue and returns its value unchanged', () => {
    vi.mocked(findOpenUpgradeIssue).mockReturnValue(55);
    const tracker = createGitHubIssueTracker(REPO_ID);

    const result = tracker.findOpenUpgradeIssue();

    expect(findOpenUpgradeIssue).toHaveBeenCalledTimes(1);
    expect(findOpenUpgradeIssue).toHaveBeenCalledWith(REPO_INFO);
    expect(result).toBe(55);
  });
});
