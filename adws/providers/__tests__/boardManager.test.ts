/**
 * Unit tests for BoardManager types and stub implementations.
 */

import { describe, it, expect } from 'vitest';
import { BoardStatus, BOARD_COLUMNS } from '../types';
import { mergeStatusOptions } from '../github/githubBoardManager';
import { createJiraBoardManager } from '../jira/jiraBoardManager';
import { createGitLabBoardManager } from '../gitlab/gitlabBoardManager';

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
    expect(merged.map((o) => o.name)).toContain(BoardStatus.Blocked);
    expect(merged.map((o) => o.name)).toContain(BoardStatus.Done);
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

  it('partial overlap: missing columns appended, changed is true', () => {
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
    // Other ADW columns should be appended (4 missing)
    expect(merged).toHaveLength(5);
    expect(changed).toBe(true);
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
