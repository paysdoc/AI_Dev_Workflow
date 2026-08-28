/**
 * ghPrApi.ts — the 13 pull-request operations relocated from GitContext's
 * former semantic surface (#797), each a one-to-one relocation of the deleted
 * core method onto a `GhCommandRunner['run']` bound to one owner/repo.
 * Deep-import only — assembled into `GhRepoApi` by `ghRepoApi.ts`.
 */

import type { GhCommandRunner } from './ghCommandRunner';
import {
  findPRByBranchCmd, fetchPRDetailsCmd, fetchPRReviewsCmd, fetchPRReviewCommentsCmd,
  commentOnPRCmd, mergePRCmd, approvePRCmd, prApprovalStateCmd,
  fetchPRListCmd, fetchAllPRsCmd, createPRCmd, fetchMergedPRsCmd, prChangedFilesCmd,
} from './commands/prCommands';

export interface GhPrApi {
  findPRByBranch(branchName: string): string;
  fetchPRDetails(prNumber: number): string;
  fetchPRReviews(prNumber: number): string;
  fetchPRReviewComments(prNumber: number): string;
  commentOnPR(prNumber: number, body: string): void;
  mergePR(prNumber: number): void;
  /** Approves a PR using the alternate identity (GitHub forbids bot self-approval). */
  approvePR(prNumber: number): void;
  prApprovalState(prNumber: number): string;
  fetchPRList(): string;
  fetchAllPRs(): string;
  fetchPRChangedFiles(prNumber: number): string;
  createPR(title: string, body: string, headBranch: string, baseBranch?: string, labels?: readonly string[]): string;
  fetchMergedPRs(limit?: number): string;
}

export function ghPrApi(run: GhCommandRunner['run'], owner: string, repo: string): GhPrApi {
  return {
    findPRByBranch: (branchName) => run(findPRByBranchCmd(owner, repo, branchName)),

    fetchPRDetails: (prNumber) => run(fetchPRDetailsCmd(owner, repo, prNumber)),

    fetchPRReviews: (prNumber) => run(fetchPRReviewsCmd(owner, repo, prNumber)),

    fetchPRReviewComments: (prNumber) => run(fetchPRReviewCommentsCmd(owner, repo, prNumber)),

    commentOnPR: (prNumber, body) => {
      run(commentOnPRCmd(owner, repo, prNumber), { input: body });
    },

    mergePR: (prNumber) => {
      run(mergePRCmd(owner, repo, prNumber));
    },

    approvePR: (prNumber) => {
      run(approvePRCmd(owner, repo, prNumber), { purpose: 'alternateIdentity' });
    },

    prApprovalState: (prNumber) => run(prApprovalStateCmd(owner, repo, prNumber)),

    fetchPRList: () => run(fetchPRListCmd(owner, repo)),

    fetchAllPRs: () => run(fetchAllPRsCmd(owner, repo)),

    fetchPRChangedFiles: (prNumber) => run(prChangedFilesCmd(owner, repo, prNumber)),

    createPR: (title, body, headBranch, baseBranch, labels) =>
      run(createPRCmd(owner, repo, title, headBranch, baseBranch, labels), { input: body }),

    fetchMergedPRs: (limit) => run(fetchMergedPRsCmd(owner, repo, limit)),
  };
}
