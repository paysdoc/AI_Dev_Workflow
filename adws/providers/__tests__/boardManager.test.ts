/**
 * Unit tests for BoardManager types and stub implementations.
 */

import { describe, it, expect } from 'vitest';
import { BoardStatus, BOARD_COLUMNS } from '../types';
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
