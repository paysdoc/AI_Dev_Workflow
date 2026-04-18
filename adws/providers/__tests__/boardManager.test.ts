/**
 * Unit tests for BoardManager types and stub implementations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BoardStatus, BOARD_COLUMNS, Platform } from '../types';
import { mergeStatusOptions, createGitHubBoardManager } from '../github/githubBoardManager';
import { createJiraBoardManager } from '../jira/jiraBoardManager';
import { createGitLabBoardManager } from '../gitlab/gitlabBoardManager';
import * as githubAppAuth from '../../github/githubAppAuth';

vi.mock('../../github/githubAppAuth', () => ({
  refreshTokenIfNeeded: vi.fn(),
  isGitHubAppConfigured: vi.fn(() => true),
}));

// GITHUB_PAT is evaluated at module load time in environment.ts;
// use a dynamic getter so tests can control it via process.env.GITHUB_PAT.
vi.mock('../../core/config', () => ({
  get GITHUB_PAT() {
    return process.env.GITHUB_PAT || undefined;
  },
}));

describe('BOARD_COLUMNS', () => {
  it('has exactly 5 entries', () => {
    expect(BOARD_COLUMNS).toHaveLength(5);
  });

  it('contains all required statuses', () => {
    const statuses = BOARD_COLUMNS.map((c) => c.status);
    expect(statuses).toContain(BoardStatus.Blocked);
    expect(statuses).toContain(BoardStatus.Todo);
    expect(statuses).toContain(BoardStatus.InProgress);
    expect(statuses).toContain(BoardStatus.Review);
    expect(statuses).toContain(BoardStatus.Done);
  });

  it('has correct order values', () => {
    const orders = BOARD_COLUMNS.map((c) => c.order);
    expect(orders).toEqual([1, 2, 3, 4, 5]);
  });

  it('has correct colors', () => {
    const blocked = BOARD_COLUMNS.find((c) => c.status === BoardStatus.Blocked);
    expect(blocked?.color).toBe('RED');

    const todo = BOARD_COLUMNS.find((c) => c.status === BoardStatus.Todo);
    expect(todo?.color).toBe('GRAY');

    const inProgress = BOARD_COLUMNS.find((c) => c.status === BoardStatus.InProgress);
    expect(inProgress?.color).toBe('YELLOW');

    const review = BOARD_COLUMNS.find((c) => c.status === BoardStatus.Review);
    expect(review?.color).toBe('PURPLE');

    const done = BOARD_COLUMNS.find((c) => c.status === BoardStatus.Done);
    expect(done?.color).toBe('GREEN');
  });

  it('has correct descriptions', () => {
    const blocked = BOARD_COLUMNS.find((c) => c.status === BoardStatus.Blocked);
    expect(blocked?.description).toBe('This item cannot be completed');

    const done = BOARD_COLUMNS.find((c) => c.status === BoardStatus.Done);
    expect(done?.description).toBe('This has been completed');
  });
});

describe('BoardStatus enum', () => {
  it('contains Blocked', () => {
    expect(BoardStatus.Blocked).toBe('Blocked');
  });

  it('contains Todo', () => {
    expect(BoardStatus.Todo).toBe('Todo');
  });

  it('contains Done', () => {
    expect(BoardStatus.Done).toBe('Done');
  });

  it('contains InProgress', () => {
    expect(BoardStatus.InProgress).toBe('In Progress');
  });

  it('contains Review', () => {
    expect(BoardStatus.Review).toBe('Review');
  });
});

describe('JiraBoardManager stub', () => {
  const manager = createJiraBoardManager();

  it('throws "not implemented" on findBoard', async () => {
    await expect(manager.findBoard()).rejects.toThrow('BoardManager not implemented for Jira');
  });

  it('throws "not implemented" on createBoard', async () => {
    await expect(manager.createBoard('test')).rejects.toThrow('BoardManager not implemented for Jira');
  });

  it('throws "not implemented" on ensureColumns', async () => {
    await expect(manager.ensureColumns('board-id')).rejects.toThrow('BoardManager not implemented for Jira');
  });
});

describe('mergeStatusOptions', () => {
  it('empty board: all ADW columns added, changed is true', () => {
    const { merged, changed, added } = mergeStatusOptions([], BOARD_COLUMNS);
    expect(changed).toBe(true);
    expect(added).toHaveLength(5);
    expect(merged).toHaveLength(5);
    expect(merged.map((o) => o.name)).toEqual([
      BoardStatus.Blocked, BoardStatus.Todo, BoardStatus.InProgress, BoardStatus.Review, BoardStatus.Done,
    ]);
  });

  it('all ADW columns already present with correct properties: changed is false', () => {
    const existing = BOARD_COLUMNS.map((col) => ({
      name: col.status,
      color: col.color,
      description: col.description,
    }));
    const { changed, added } = mergeStatusOptions(existing, BOARD_COLUMNS);
    expect(changed).toBe(false);
    expect(added).toHaveLength(0);
  });

  it('partial overlap: missing columns inserted in canonical order, changed is true', () => {
    const existing = [
      { name: BoardStatus.Todo, color: 'GRAY', description: "This item hasn't been started" },
      { name: BoardStatus.Done, color: 'GREEN', description: 'This has been completed' },
    ];
    const { merged, changed, added } = mergeStatusOptions(existing, BOARD_COLUMNS);
    expect(changed).toBe(true);
    expect(added).toHaveLength(3);
    expect(added).toContain(BoardStatus.Blocked);
    expect(added).toContain(BoardStatus.InProgress);
    expect(added).toContain(BoardStatus.Review);
    expect(merged).toHaveLength(5);
    expect(merged.map((o) => o.name)).toEqual([
      BoardStatus.Blocked, BoardStatus.Todo, BoardStatus.InProgress, BoardStatus.Review, BoardStatus.Done,
    ]);
  });

  it('non-ADW columns are preserved in merged list', () => {
    const existing = [
      { name: 'Custom', color: 'BLUE', description: 'A custom column' },
      ...BOARD_COLUMNS.map((col) => ({ name: col.status, color: col.color, description: col.description })),
    ];
    const { merged, changed } = mergeStatusOptions(existing, BOARD_COLUMNS);
    expect(merged.some((o) => o.name === 'Custom')).toBe(true);
    expect(merged).toHaveLength(6);
    expect(changed).toBe(false);
  });

  it('ADW columns with wrong color/description are overwritten', () => {
    const existing = [
      { name: BoardStatus.Blocked, color: 'BLUE', description: 'Wrong description' },
    ];
    const { merged, changed } = mergeStatusOptions(existing, BOARD_COLUMNS);
    const blocked = merged.find((o) => o.name === BoardStatus.Blocked);
    expect(blocked?.color).toBe('RED');
    expect(blocked?.description).toBe('This item cannot be completed');
    expect(changed).toBe(true);
  });

  it('case-insensitive matching: "todo" matches BoardStatus.Todo', () => {
    const existing = [
      { name: 'todo', color: 'GRAY', description: "This item hasn't been started" },
    ];
    const { merged, changed } = mergeStatusOptions(existing, BOARD_COLUMNS);
    // The matching option should be overwritten with canonical casing from BOARD_COLUMNS
    const todo = merged.find((o) => o.name.toLowerCase() === 'todo');
    expect(todo?.name).toBe(BoardStatus.Todo);
    // Missing columns inserted in canonical order around the matched Todo
    expect(merged).toHaveLength(5);
    expect(changed).toBe(true);
    expect(merged.map((o) => o.name)).toEqual([
      BoardStatus.Blocked, BoardStatus.Todo, BoardStatus.InProgress, BoardStatus.Review, BoardStatus.Done,
    ]);
  });

  it('missing Blocked is inserted at index 0 when [Todo, InProgress, Review, Done] exist', () => {
    const existing = [
      { id: 'opt-todo', name: BoardStatus.Todo, color: 'GRAY', description: "This item hasn't been started" },
      { id: 'opt-inprogress', name: BoardStatus.InProgress, color: 'YELLOW', description: 'This is actively being worked on' },
      { id: 'opt-review', name: BoardStatus.Review, color: 'PURPLE', description: 'This item is being peer reviewed' },
      { id: 'opt-done', name: BoardStatus.Done, color: 'GREEN', description: 'This has been completed' },
    ];
    const { merged, changed, added } = mergeStatusOptions(existing, BOARD_COLUMNS);
    expect(merged[0].name).toBe(BoardStatus.Blocked);
    expect(merged.map((o) => o.name)).toEqual([
      BoardStatus.Blocked, BoardStatus.Todo, BoardStatus.InProgress, BoardStatus.Review, BoardStatus.Done,
    ]);
    expect(added).toEqual([BoardStatus.Blocked]);
    expect(changed).toBe(true);
  });

  it('missing Review is inserted between InProgress and Done', () => {
    const existing = [
      { id: 'opt-blocked', name: BoardStatus.Blocked, color: 'RED', description: 'This item cannot be completed' },
      { id: 'opt-todo', name: BoardStatus.Todo, color: 'GRAY', description: "This item hasn't been started" },
      { id: 'opt-inprogress', name: BoardStatus.InProgress, color: 'YELLOW', description: 'This is actively being worked on' },
      { id: 'opt-done', name: BoardStatus.Done, color: 'GREEN', description: 'This has been completed' },
    ];
    const { merged, added } = mergeStatusOptions(existing, BOARD_COLUMNS);
    expect(merged.map((o) => o.name)).toEqual([
      BoardStatus.Blocked, BoardStatus.Todo, BoardStatus.InProgress, BoardStatus.Review, BoardStatus.Done,
    ]);
    expect(added).toEqual([BoardStatus.Review]);
  });

  it('all five missing: merged is in BOARD_COLUMNS order', () => {
    const { merged, added } = mergeStatusOptions([], BOARD_COLUMNS);
    expect(merged.map((o) => o.name)).toEqual(['Blocked', 'Todo', 'In Progress', 'Review', 'Done']);
    expect(added).toHaveLength(5);
    expect(merged.every((o) => o.id === undefined)).toBe(true);
  });

  it('non-ADW options keep their relative position when missing columns are inserted', () => {
    const existing = [
      { id: 'opt-custom-1', name: 'Custom1', color: 'BLUE', description: 'x' },
      { id: 'opt-todo', name: BoardStatus.Todo, color: 'GRAY', description: "This item hasn't been started" },
      { id: 'opt-done', name: BoardStatus.Done, color: 'GREEN', description: 'This has been completed' },
      { id: 'opt-custom-2', name: 'Custom2', color: 'PINK', description: 'y' },
    ];
    const { merged } = mergeStatusOptions(existing, BOARD_COLUMNS);
    expect(merged[0].name).toBe('Custom1');
    expect(merged[merged.length - 1].name).toBe('Custom2');
    expect(merged.some((o) => o.name === BoardStatus.Blocked)).toBe(true);
    expect(merged.some((o) => o.name === BoardStatus.InProgress)).toBe(true);
    expect(merged.some((o) => o.name === BoardStatus.Review)).toBe(true);
  });

  it('every existing option id survives into merged', () => {
    const existing = [
      { id: 'opt-blocked', name: BoardStatus.Blocked, color: 'BLUE', description: 'wrong color' },
      { id: 'opt-todo', name: BoardStatus.Todo, color: 'GRAY', description: "This item hasn't been started" },
      { id: 'opt-inprogress', name: BoardStatus.InProgress, color: 'YELLOW', description: 'This is actively being worked on' },
      { id: 'opt-review', name: BoardStatus.Review, color: 'PURPLE', description: 'This item is being peer reviewed' },
      { id: 'opt-done', name: BoardStatus.Done, color: 'GREEN', description: 'This has been completed' },
      { id: 'opt-custom', name: 'Custom', color: 'PINK', description: 'custom col' },
    ];
    const { merged } = mergeStatusOptions(existing, BOARD_COLUMNS);
    const blocked = merged.find((o) => o.name === BoardStatus.Blocked);
    expect(blocked?.color).toBe('RED'); // overwritten with BOARD_COLUMNS default
    expect(blocked?.id).toBe('opt-blocked'); // id preserved
    const custom = merged.find((o) => o.name === 'Custom');
    expect(custom?.id).toBe('opt-custom');
    existing.forEach((e) => {
      const m = merged.find((o) => o.name.toLowerCase() === e.name.toLowerCase());
      expect(m?.id).toBe(e.id);
    });
  });

  it('newly added ADW options have id === undefined', () => {
    const { merged: allNew } = mergeStatusOptions([], BOARD_COLUMNS);
    expect(allNew.every((o) => o.id === undefined)).toBe(true);

    const existing = [
      { id: 'opt-todo', name: BoardStatus.Todo, color: 'GRAY', description: "This item hasn't been started" },
      { id: 'opt-done', name: BoardStatus.Done, color: 'GREEN', description: 'This has been completed' },
    ];
    const { merged: partial } = mergeStatusOptions(existing, BOARD_COLUMNS);
    const todo = partial.find((o) => o.name === BoardStatus.Todo);
    const done = partial.find((o) => o.name === BoardStatus.Done);
    expect(todo?.id).toBe('opt-todo');
    expect(done?.id).toBe('opt-done');
    const newOnes = partial.filter((o) => o.name !== BoardStatus.Todo && o.name !== BoardStatus.Done);
    expect(newOnes.every((o) => o.id === undefined)).toBe(true);
  });
});

describe('GitHubBoardManager PAT fallback wrapper', () => {
  const isGitHubAppConfigured = vi.mocked(githubAppAuth.isGitHubAppConfigured);

  let savedGhToken: string | undefined;
  let savedGithubPat: string | undefined;

  beforeEach(() => {
    savedGhToken = process.env.GH_TOKEN;
    savedGithubPat = process.env.GITHUB_PAT;
    isGitHubAppConfigured.mockReturnValue(true);
  });

  afterEach(() => {
    process.env.GH_TOKEN = savedGhToken;
    if (savedGithubPat === undefined) {
      delete process.env.GITHUB_PAT;
    } else {
      process.env.GITHUB_PAT = savedGithubPat;
    }
    vi.clearAllMocks();
  });

  function makeManager() {
    return createGitHubBoardManager({ platform: Platform.GitHub, owner: 'x', repo: 'y' }) as unknown as {
      withProjectBoardAuth: <T>(fn: () => Promise<T>) => Promise<T>;
    };
  }

  it('swaps GH_TOKEN to GITHUB_PAT during fn() and restores after', async () => {
    process.env.GH_TOKEN = 'app-token';
    process.env.GITHUB_PAT = 'my-pat';

    const manager = makeManager();
    let tokenDuringFn = '';

    await manager.withProjectBoardAuth(async () => {
      tokenDuringFn = process.env.GH_TOKEN ?? '';
      return 'ok';
    });

    expect(tokenDuringFn).toBe('my-pat');
    expect(process.env.GH_TOKEN).toBe('app-token');
  });

  it('restores GH_TOKEN even when fn() throws', async () => {
    process.env.GH_TOKEN = 'app-token';
    process.env.GITHUB_PAT = 'my-pat';

    const manager = makeManager();

    await expect(
      manager.withProjectBoardAuth(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(process.env.GH_TOKEN).toBe('app-token');
  });

  it('is a no-op when GITHUB_PAT is undefined', async () => {
    process.env.GH_TOKEN = 'app-token';
    delete process.env.GITHUB_PAT;

    const manager = makeManager();
    let tokenDuringFn = '';

    await manager.withProjectBoardAuth(async () => {
      tokenDuringFn = process.env.GH_TOKEN ?? '';
      return 'ok';
    });

    expect(tokenDuringFn).toBe('app-token');
    expect(process.env.GH_TOKEN).toBe('app-token');
  });

  it('is a no-op when GITHUB_PAT equals GH_TOKEN', async () => {
    process.env.GH_TOKEN = 'same-token';
    process.env.GITHUB_PAT = 'same-token';

    const manager = makeManager();
    let tokenDuringFn = '';

    await manager.withProjectBoardAuth(async () => {
      tokenDuringFn = process.env.GH_TOKEN ?? '';
      return 'ok';
    });

    expect(tokenDuringFn).toBe('same-token');
    expect(process.env.GH_TOKEN).toBe('same-token');
  });

  it('is a no-op when isGitHubAppConfigured() returns false', async () => {
    process.env.GH_TOKEN = 'app-token';
    process.env.GITHUB_PAT = 'my-pat';
    isGitHubAppConfigured.mockReturnValue(false);

    const manager = makeManager();
    let tokenDuringFn = '';

    await manager.withProjectBoardAuth(async () => {
      tokenDuringFn = process.env.GH_TOKEN ?? '';
      return 'ok';
    });

    expect(tokenDuringFn).toBe('app-token');
    expect(process.env.GH_TOKEN).toBe('app-token');
  });

  it('is a no-op when GITHUB_PAT is an empty string', async () => {
    process.env.GH_TOKEN = 'app-token';
    process.env.GITHUB_PAT = '';

    const manager = makeManager();
    let tokenDuringFn = '';

    await manager.withProjectBoardAuth(async () => {
      tokenDuringFn = process.env.GH_TOKEN ?? '';
      return 'ok';
    });

    expect(tokenDuringFn).toBe('app-token');
    expect(process.env.GH_TOKEN).toBe('app-token');
  });
});

describe('GitLabBoardManager stub', () => {
  const manager = createGitLabBoardManager();

  it('throws "not implemented" on findBoard', async () => {
    await expect(manager.findBoard()).rejects.toThrow('BoardManager not implemented for GitLab');
  });

  it('throws "not implemented" on createBoard', async () => {
    await expect(manager.createBoard('test')).rejects.toThrow('BoardManager not implemented for GitLab');
  });

  it('throws "not implemented" on ensureColumns', async () => {
    await expect(manager.ensureColumns('board-id')).rejects.toThrow('BoardManager not implemented for GitLab');
  });
});
