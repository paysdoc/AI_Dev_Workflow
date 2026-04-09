/**
 * GitLab stub implementation of the BoardManager provider interface.
 * All methods throw — GitLab board management is not yet supported.
 */

import type { BoardManager } from '../types';

/**
 * Stub BoardManager for GitLab.
 * Throws "not implemented" for all methods.
 */
class GitLabBoardManager implements BoardManager {
  async findBoard(): Promise<string | null> {
    throw new Error('BoardManager not implemented for GitLab');
  }

  async createBoard(_name: string): Promise<string> {
    throw new Error('BoardManager not implemented for GitLab');
  }

  async ensureColumns(_boardId: string): Promise<boolean> {
    throw new Error('BoardManager not implemented for GitLab');
  }
}

/**
 * Factory function to create a GitLab BoardManager stub.
 * @returns A BoardManager instance that throws for all operations.
 */
export function createGitLabBoardManager(): BoardManager {
  return new GitLabBoardManager();
}
