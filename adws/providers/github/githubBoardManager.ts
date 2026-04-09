/**
 * GitHub implementation of the BoardManager provider interface.
 * Ensures a GitHub Projects V2 board exists for the repository and
 * that all required ADW columns are present.
 */

import { execSync } from 'child_process';
import { log } from '../../core';
import { GITHUB_PAT } from '../../core/config';
import { isGitHubAppConfigured, refreshTokenIfNeeded } from '../../github/githubAppAuth';
import type { BoardManager, RepoIdentifier } from '../types';
import { BOARD_COLUMNS, validateRepoIdentifier } from '../types';
import { toRepoInfo } from './mappers';
import type { RepoInfo } from '../../github/githubApi';

/**
 * GitHub implementation of the BoardManager interface.
 * Bound to a specific repository at construction time.
 */
class GitHubBoardManager implements BoardManager {
  private readonly repoInfo: RepoInfo;

  constructor(private readonly repoId: RepoIdentifier) {
    validateRepoIdentifier(repoId);
    this.repoInfo = toRepoInfo(repoId);
  }

  /**
   * Finds the first GitHub Projects V2 board linked to the repository.
   * Uses the PAT fallback pattern when the app token cannot access Projects V2.
   * @returns The project ID, or null if no project is linked.
   */
  async findBoard(): Promise<string | null> {
    const { owner, repo } = this.repoInfo;
    refreshTokenIfNeeded(owner, repo);

    let projectId = this.queryProjectId(owner, repo);

    // PAT fallback: if app token can't access Projects V2, retry with GITHUB_PAT
    if (!projectId && isGitHubAppConfigured() && GITHUB_PAT && GITHUB_PAT !== process.env.GH_TOKEN) {
      log('App token cannot access Projects V2, retrying with GITHUB_PAT', 'info');
      const savedToken = process.env.GH_TOKEN;
      process.env.GH_TOKEN = GITHUB_PAT;
      try {
        projectId = this.queryProjectId(owner, repo);
      } finally {
        process.env.GH_TOKEN = savedToken;
      }
    }

    return projectId;
  }

  /**
   * Creates a new GitHub Projects V2 board for the repository.
   * Detects whether the owner is a user or organization, creates the project,
   * and links it to the repository.
   * @param name - The name of the project board to create.
   * @returns The new project ID.
   */
  async createBoard(name: string): Promise<string> {
    const { owner, repo } = this.repoInfo;

    // Look up the owner node ID
    const ownerIdQuery = `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          owner { id }
        }
      }
    `;
    const ownerIdResult = execSync(
      `gh api graphql -f query='${ownerIdQuery}' -f owner='${owner}' -f repo='${repo}'`,
      { encoding: 'utf-8' },
    );
    const ownerIdParsed = JSON.parse(ownerIdResult) as {
      data: { repository: { owner: { id: string } } };
    };
    const ownerId = ownerIdParsed.data.repository.owner.id;

    // Create the project
    const createMutation = `
      mutation($ownerId: ID!, $title: String!) {
        createProjectV2(input: { ownerId: $ownerId, title: $title }) {
          projectV2 { id }
        }
      }
    `;
    const createResult = execSync(
      `gh api graphql -f query='${createMutation}' -f ownerId='${ownerId}' -f title='${name}'`,
      { encoding: 'utf-8' },
    );
    const createParsed = JSON.parse(createResult) as {
      data: { createProjectV2: { projectV2: { id: string } } };
    };
    const projectId = createParsed.data.createProjectV2.projectV2.id;

    // Link the project to the repository
    const repoNodeQuery = `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) { id }
      }
    `;
    const repoNodeResult = execSync(
      `gh api graphql -f query='${repoNodeQuery}' -f owner='${owner}' -f repo='${repo}'`,
      { encoding: 'utf-8' },
    );
    const repoNodeParsed = JSON.parse(repoNodeResult) as {
      data: { repository: { id: string } };
    };
    const repositoryId = repoNodeParsed.data.repository.id;

    const linkMutation = `
      mutation($projectId: ID!, $repositoryId: ID!) {
        linkProjectV2ToRepository(input: { projectId: $projectId, repositoryId: $repositoryId }) {
          repository { id }
        }
      }
    `;
    execSync(
      `gh api graphql -f query='${linkMutation}' -f projectId='${projectId}' -f repositoryId='${repositoryId}'`,
      { encoding: 'utf-8' },
    );

    log(`Created project board "${name}" (id: ${projectId})`, 'success');
    return projectId;
  }

  /**
   * Ensures all required ADW columns exist on the board.
   * Reads existing options and creates any that are missing.
   * Leaves existing columns untouched.
   * @param boardId - The project board ID.
   * @returns true when all columns are present.
   */
  async ensureColumns(boardId: string): Promise<boolean> {
    const statusField = this.getStatusFieldOptions(boardId);
    if (!statusField) {
      log('No Status field found on project board', 'warn');
      return false;
    }

    const existingNames = new Set(statusField.options.map((o) => o.name.toLowerCase()));

    for (const column of BOARD_COLUMNS) {
      if (!existingNames.has(column.status.toLowerCase())) {
        this.addStatusOption(boardId, statusField.fieldId, column.status, column.color, column.description);
        log(`Added board column "${column.status}"`, 'info');
      }
    }

    return true;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private queryProjectId(owner: string, repo: string): string | null {
    try {
      const query = `
        query($owner: String!, $repo: String!) {
          repository(owner: $owner, name: $repo) {
            projectsV2(first: 1) {
              nodes { id }
            }
          }
        }
      `;
      const result = execSync(
        `gh api graphql -f query='${query}' -f owner='${owner}' -f repo='${repo}'`,
        { encoding: 'utf-8' },
      );
      const parsed = JSON.parse(result) as {
        data: { repository: { projectsV2: { nodes: Array<{ id: string }> } } };
      };
      const nodes = parsed.data.repository.projectsV2.nodes;
      return nodes.length > 0 ? nodes[0].id : null;
    } catch (error) {
      log(`Failed to find project for ${owner}/${repo}: ${error}`, 'warn');
      return null;
    }
  }

  private getStatusFieldOptions(
    projectId: string,
  ): { fieldId: string; options: Array<{ id: string; name: string }> } | null {
    try {
      const query = `
        query($projectId: ID!) {
          node(id: $projectId) {
            ... on ProjectV2 {
              field(name: "Status") {
                ... on ProjectV2SingleSelectField {
                  id
                  options { id name }
                }
              }
            }
          }
        }
      `;
      const result = execSync(
        `gh api graphql -f query='${query}' -f projectId='${projectId}'`,
        { encoding: 'utf-8' },
      );
      const parsed = JSON.parse(result) as {
        data: {
          node: {
            field: { id: string; options: Array<{ id: string; name: string }> } | null;
          };
        };
      };
      const field = parsed.data.node.field;
      if (!field || !field.id) return null;
      return { fieldId: field.id, options: field.options };
    } catch (error) {
      log(`Failed to get status field options: ${error}`, 'warn');
      return null;
    }
  }

  private addStatusOption(
    projectId: string,
    fieldId: string,
    name: string,
    color: string,
    description: string,
  ): void {
    const mutation = `
      mutation($projectId: ID!, $fieldId: ID!, $name: String!, $color: ProjectV2SingleSelectFieldOptionColor!, $description: String!) {
        updateProjectV2Field(input: {
          projectId: $projectId
          fieldId: $fieldId
          singleSelectOptions: [{ name: $name, color: $color, description: $description }]
        }) {
          projectV2Field {
            ... on ProjectV2SingleSelectField { id }
          }
        }
      }
    `;
    execSync(
      `gh api graphql -f query='${mutation}' -f projectId='${projectId}' -f fieldId='${fieldId}' -f name='${name}' -f color='${color}' -f description='${description}'`,
      { encoding: 'utf-8' },
    );
  }
}

/**
 * Factory function to create a GitHub BoardManager provider.
 * @param repoId - The repository identifier to bind the provider to.
 * @returns A BoardManager instance bound to the specified repository.
 */
export function createGitHubBoardManager(repoId: RepoIdentifier): BoardManager {
  return new GitHubBoardManager(repoId);
}
