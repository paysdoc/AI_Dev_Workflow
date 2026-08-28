/**
 * ghRepoApi.ts — the relocation target of GitContext's former semantic
 * surface (#797). Composes the issue and PR leaf factories with the
 * repo/label/secret/board remainder into one `GhRepoApi` view over a
 * `GitContext` the caller already holds. Deep-import only: never added to
 * `./index.ts`, exactly like `ghIssueApi`/`ghPrApi` and `createGhCommandRunner`
 * — a bound view over an existing context selects no identity, so it is not a
 * construction site the guard's `unsanctioned-construction` rule needs to see.
 */

import type { GitContext } from '../../gitContext';
import { createGhCommandRunner, type GhCommandRunner } from './ghCommandRunner';
import { ghIssueApi, type GhIssueApi } from './ghIssueApi';
import { ghPrApi, type GhPrApi } from './ghPrApi';
import { createLabelCmd, applyLabelCmd } from './commands/labelCommands';
import { setSecretCmd } from './commands/secretCommands';
import {
  graphQLCmd, graphQLInputCmd, projectQueryCmd, itemQueryCmd, fieldQueryCmd, moveStatusCmd,
  parseProjectId, parseIssueItem, parseStatusField,
} from './commands/boardCommands';

export interface GhRepoOps {
  defaultBranch(): string;
  authenticatedUser(): string;
  createLabel(name: string, color: string, description: string): void;
  applyLabel(issueNumber: number, labelName: string): void;
  setSecret(name: string, value: string): void;
  runGraphQL(query: string, variables?: Record<string, string | number>): string;
  /** stdin-JSON form for GraphQL mutations with complex/array variables the flag form cannot express. */
  runGraphQLInput(body: Record<string, unknown>): string;
  /**
   * Moves a GitHub issue to a target status on its Projects V2 board.
   * Returns true if the move succeeded; false if no project, no item, or no status match.
   */
  moveIssueToStatus(issueNumber: number, targetStatus: string): boolean;
}

export type GhRepoApi = GhIssueApi & GhPrApi & GhRepoOps;

function ghRepoOps(run: GhCommandRunner['run'], owner: string, repo: string): GhRepoOps {
  return {
    defaultBranch: () =>
      run(`gh repo view ${owner}/${repo} --json defaultBranchRef --jq .defaultBranchRef.name`),

    authenticatedUser: () => run('gh api user'),

    createLabel: (name, color, description) => {
      run(createLabelCmd(owner, repo, name, color, description));
    },

    applyLabel: (issueNumber, labelName) => {
      run(applyLabelCmd(owner, repo, issueNumber, labelName));
    },

    setSecret: (name, value) => {
      run(setSecretCmd(owner, repo, name), { input: value });
    },

    runGraphQL: (query, variables) => run(graphQLCmd(query, variables), { purpose: 'alternateIdentity' }),

    runGraphQLInput: (body) =>
      run(graphQLInputCmd(), { input: JSON.stringify(body), purpose: 'alternateIdentity' }),

    moveIssueToStatus: (issueNumber, targetStatus) => {
      let projectId: string | null = null;
      try {
        projectId = parseProjectId(run(projectQueryCmd(owner, repo), { purpose: 'alternateIdentity' }));
      } catch { return false; }
      if (!projectId) return false;

      let item: { itemId: string; currentStatus: string | null } | null = null;
      try {
        item = parseIssueItem(
          run(itemQueryCmd(owner, repo, issueNumber), { purpose: 'alternateIdentity' }),
          projectId,
        );
      } catch { return false; }
      if (!item) return false;
      if (item.currentStatus?.toLowerCase() === targetStatus.toLowerCase()) return true;

      let field: { fieldId: string; optionId: string } | 'already_at_status' | null = null;
      try {
        field = parseStatusField(
          run(fieldQueryCmd(projectId), { purpose: 'alternateIdentity' }),
          targetStatus,
          item.currentStatus,
        );
      } catch { return false; }
      if (!field) return false;
      if (field === 'already_at_status') return true;

      try {
        run(moveStatusCmd(projectId, item.itemId, field.fieldId, field.optionId), { purpose: 'alternateIdentity' });
      } catch { return false; }
      return true;
    },
  };
}

/** Composes the full 35-operation `GhRepoApi` over `ctx` — a bound view, selecting no identity. */
export function createGhRepoApi(ctx: GitContext): GhRepoApi {
  const { run } = createGhCommandRunner(ctx);
  return {
    ...ghIssueApi(run, ctx.owner, ctx.repo),
    ...ghPrApi(run, ctx.owner, ctx.repo),
    ...ghRepoOps(run, ctx.owner, ctx.repo),
  };
}
