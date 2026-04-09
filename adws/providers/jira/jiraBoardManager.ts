/**
 * Jira stub implementation of the BoardManager provider interface.
 * All methods throw — Jira board management is not yet supported.
 */

import type { BoardManager } from '../types';

/**
 * Stub BoardManager for Jira.
 * Throws "not implemented" for all methods.
 */
class JiraBoardManager implements BoardManager {
  async findBoard(): Promise<string | null> {
    throw new Error('BoardManager not implemented for Jira');
  }

  async createBoard(_name: string): Promise<string> {
    throw new Error('BoardManager not implemented for Jira');
  }

  async ensureColumns(_boardId: string): Promise<boolean> {
    throw new Error('BoardManager not implemented for Jira');
  }
}

/**
 * Factory function to create a Jira BoardManager stub.
 * @returns A BoardManager instance that throws for all operations.
 */
export function createJiraBoardManager(): BoardManager {
  return new JiraBoardManager();
}
