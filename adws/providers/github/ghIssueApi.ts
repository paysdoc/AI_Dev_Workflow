/**
 * ghIssueApi.ts — the 14 issue operations relocated from GitContext's former
 * semantic surface (#797), each a one-to-one relocation of the deleted core
 * method onto a `GhCommandRunner['run']` bound to one owner/repo. Deep-import
 * only — assembled into `GhRepoApi` by `ghRepoApi.ts`.
 */

import type { GhCommandRunner } from './ghCommandRunner';
import {
  fetchIssueCmd, commentOnIssueCmd, issueStateCmd, closeIssueCmd, issueTitleCmd,
  fetchIssueCommentsCmd, issueHasLabelCmd, addIssueLabelCmd, createIssueCmd,
  updateIssueBodyCmd, findOpenUpgradeIssueCmd, deleteIssueCommentCmd,
  listOpenIssuesCmd, issueCommentsCmd,
  type ListOpenIssuesOptions,
} from './commands/issueCommands';

export interface GhIssueApi {
  fetchIssue(issueNumber: number): string;
  commentOnIssue(issueNumber: number, body: string): void;
  issueState(issueNumber: number): string;
  closeIssue(issueNumber: number): void;
  issueTitle(issueNumber: number): string;
  fetchIssueComments(issueNumber: number): string;
  /** The issue's labels JSON. Renamed from GitContext's misnamed `issueHasLabel` — same command. */
  issueLabels(issueNumber: number): string;
  addIssueLabel(issueNumber: number, labelName: string): void;
  createIssue(title: string, body: string): string;
  updateIssueBody(issueNumber: number, body: string): void;
  findOpenUpgradeIssue(): string;
  deleteIssueComment(commentId: number): void;
  listOpenIssues(opts: ListOpenIssuesOptions): string;
  issueComments(issueNumber: number): string;
}

export function ghIssueApi(run: GhCommandRunner['run'], owner: string, repo: string): GhIssueApi {
  return {
    fetchIssue: (issueNumber) => run(fetchIssueCmd(owner, repo, issueNumber)),

    commentOnIssue: (issueNumber, body) => {
      run(commentOnIssueCmd(owner, repo, issueNumber), { input: body });
    },

    issueState: (issueNumber) => run(issueStateCmd(owner, repo, issueNumber)),

    closeIssue: (issueNumber) => {
      run(closeIssueCmd(owner, repo, issueNumber));
    },

    issueTitle: (issueNumber) => run(issueTitleCmd(owner, repo, issueNumber)),

    fetchIssueComments: (issueNumber) => run(fetchIssueCommentsCmd(owner, repo, issueNumber)),

    issueLabels: (issueNumber) => run(issueHasLabelCmd(owner, repo, issueNumber)),

    addIssueLabel: (issueNumber, labelName) => {
      run(addIssueLabelCmd(owner, repo, issueNumber, labelName));
    },

    createIssue: (title, body) => run(createIssueCmd(owner, repo, title), { input: body }),

    updateIssueBody: (issueNumber, body) => {
      run(updateIssueBodyCmd(owner, repo, issueNumber), { input: body });
    },

    findOpenUpgradeIssue: () => run(findOpenUpgradeIssueCmd(owner, repo)),

    deleteIssueComment: (commentId) => {
      run(deleteIssueCommentCmd(owner, repo, commentId));
    },

    listOpenIssues: (opts) => run(listOpenIssuesCmd(owner, repo, opts)),

    issueComments: (issueNumber) => run(issueCommentsCmd(owner, repo, issueNumber)),
  };
}
