/**
 * GitHub implementation of the BoardManager provider interface.
 * Ensures a GitHub Projects V2 board exists for the repository and
 * that all required ADW columns are present.
 */

import { execSync } from 'child_process';
import { log } from '../../core';
import { GITHUB_PAT } from '../../core/config';
import { isGitHubAppConfigured, refreshTokenIfNeeded } from '../../github/githubAppAuth';
import type { BoardManager, BoardColumnDefinition, RepoIdentifier } from '../types';
import { BOARD_COLUMNS, validateRepoIdentifier } from '../types';
import { toRepoInfo } from './mappers';
import type { RepoInfo } from '../../github/githubApi';

type StatusOption = { id?: string; name: string; color: string; description: string };

/**
 * Merges existing board options with the required ADW columns.
 * Preserves existing option IDs. Inserts missing ADW columns at
 * positions derived from BOARD_COLUMNS.order using an anchor rule.
 */
export function mergeStatusOptions(
  existing: Array<{ id?: string; name: string; color: string; description: string }>,
  adwColumns: readonly BoardColumnDefinition[],
): { merged: StatusOption[]; changed: boolean; added: string[] } {
  const adwByName = new Map(adwColumns.map((col) => [col.status.toLowerCase(), col]));

  const merged: StatusOption[] = existing.map((opt) => {
    const adwCol = adwByName.get(opt.name.toLowerCase());
    if (!adwCol) return { ...opt };
    return { id: opt.id, name: adwCol.status, color: adwCol.color, description: adwCol.description };
  });

  const existingLower = new Set(existing.map((o) => o.name.toLowerCase()));
  const missingCols = adwColumns.filter((col) => !existingLower.has(col.status.toLowerCase()));

  let nextInsertIdx = 0;
  for (const col of missingCols) {
    const adwInMerged: Array<{ order: number; index: number }> = [];
    for (let i = 0; i < merged.length; i++) {
      const def = adwByName.get(merged[i].name.toLowerCase());
      if (def) adwInMerged.push({ order: def.order, index: i });
    }

    let insertAt: number;
    if (adwInMerged.length === 0) {
      insertAt = nextInsertIdx;
    } else {
      const anchor = adwInMerged
        .filter((a) => a.order <= col.order)
        .reduce<{ order: number; index: number } | null>(
          (best, a) => (best === null || a.order > best.order ? a : best),
          null,
        );
      insertAt = anchor !== null ? anchor.index + 1 : adwInMerged[0].index;
    }
    merged.splice(insertAt, 0, { name: col.status, color: col.color, description: col.description });
    nextInsertIdx = insertAt + 1;
  }

  const added = missingCols.map((c) => c.status);
  const changed =
    added.length > 0 ||
    existing.length !== merged.length ||
    existing.some((opt, i) => {
      const m = merged[i];
      return m.name !== opt.name || m.color !== opt.color || m.description !== opt.description;
    });

  return { merged, changed, added };
}

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

  /** Finds the first GitHub Projects V2 board linked to the repository. */
  async findBoard(): Promise<string | null> {
    const { owner, repo } = this.repoInfo;
    return this.withProjectBoardAuth(async () => this.queryProjectId(owner, repo));
  }

  /** Creates a new GitHub Projects V2 board and links it to the repository. */
  async createBoard(name: string): Promise<string> {
    return this.withProjectBoardAuth(async () => {
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
    });
  }

  private updateStatusFieldOptions(fieldId: string, options: StatusOption[]): void {
    const mutation = `
      mutation($fieldId: ID!, $singleSelectOptions: [ProjectV2SingleSelectFieldOptionInput!]!) {
        updateProjectV2Field(input: {
          fieldId: $fieldId
          singleSelectOptions: $singleSelectOptions
        }) {
          projectV2Field {
            ... on ProjectV2SingleSelectField { id }
          }
        }
      }
    `;
    const singleSelectOptions = options.map((o) =>
      o.id !== undefined
        ? { id: o.id, name: o.name, color: o.color, description: o.description }
        : { name: o.name, color: o.color, description: o.description },
    );
    const body = { query: mutation, variables: { fieldId, singleSelectOptions } };
    execSync('gh api graphql --input -', { input: JSON.stringify(body), encoding: 'utf-8' });
  }

  /** Ensures all required ADW columns exist on the board. */
  async ensureColumns(boardId: string): Promise<boolean> {
    return this.withProjectBoardAuth(async () => {
      const statusField = this.getStatusFieldOptions(boardId);
      if (!statusField) {
        log('No Status field found on project board', 'warn');
        return false;
      }

      const { merged, changed, added } = mergeStatusOptions(statusField.options, BOARD_COLUMNS);

      if (!changed) return true;

      this.updateStatusFieldOptions(statusField.fieldId, merged);
      added.forEach((name) => log(`Added board column "${name}"`, 'info'));

      return true;
    });
  }

  // Upfront PAT swap for all board ops; idempotent; safe because ADW board-init is
  // sequential (concurrent instances in same process would race on process.env.GH_TOKEN).
  private async withProjectBoardAuth<T>(fn: () => Promise<T>): Promise<T> {
    const { owner, repo } = this.repoInfo;
    refreshTokenIfNeeded(owner, repo);

    let savedToken: string | undefined;
    let usingPatFallback = false;
    try {
      if (isGitHubAppConfigured() && GITHUB_PAT && GITHUB_PAT !== process.env.GH_TOKEN) {
        log('Using GITHUB_PAT for project board operations (app tokens lack Projects V2 access)', 'info');
        savedToken = process.env.GH_TOKEN;
        process.env.GH_TOKEN = GITHUB_PAT;
        usingPatFallback = true;
      }
      return await fn();
    } finally {
      if (usingPatFallback) {
        process.env.GH_TOKEN = savedToken;
      }
    }
  }

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
  ): { fieldId: string; options: Array<{ id: string; name: string; color: string; description: string }> } | null {
    try {
      const query = `
        query($projectId: ID!) {
          node(id: $projectId) {
            ... on ProjectV2 {
              field(name: "Status") {
                ... on ProjectV2SingleSelectField {
                  id
                  options { id name color description }
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
            field: { id: string; options: Array<{ id: string; name: string; color: string; description: string }> } | null;
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
}

/** Factory function to create a GitHub BoardManager provider. */
export function createGitHubBoardManager(repoId: RepoIdentifier): BoardManager {
  return new GitHubBoardManager(repoId);
}
