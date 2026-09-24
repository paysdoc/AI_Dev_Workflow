import type { TagProofResult, ScenarioProofResult } from '../phases/scenarioProof';
import type { UploadOptions, UploadResult } from '../r2/types';
import type { RepoIdentifier } from '@paysdoc/devplatform';

export interface ProofArtifact {
  readonly absPath: string;
  /**
   * Path relative to the harvest root, POSIX-normalised (forward slashes).
   * Used to derive the scenario group key (leading path segment).
   */
  readonly relPath: string;
}

export interface UploadedArtifact {
  /** Scenario group key (leading path segment of relPath, or 'Screenshots' for flat files). */
  readonly scenario: string;
  readonly url: string;
  /** File name (basename of relPath). */
  readonly fileName: string;
}

export type TagProofResultLike = Pick<
  TagProofResult,
  'resolvedTag' | 'severity' | 'passed' | 'skipped' | 'counts'
>;

export interface ProofCommentInput {
  readonly tagResults: readonly TagProofResultLike[];
  readonly uploaded: readonly UploadedArtifact[];
  readonly r2Configured: boolean;
}

/** Injected uploader function (defaults to the real `uploadToR2`). */
export type UploaderFn = (options: UploadOptions) => Promise<UploadResult>;

/** Injected commenter function — bound to the code host that owns the PR (`repoContext.codeHost.commentOnPullRequest`). */
export type CommenterFn = (prNumber: number, body: string) => void;

export interface PublishDeps {
  /** Absolute path to the artifacts directory (from ScenarioProofResult.artifactsDir). */
  readonly artifactsDir: string | undefined;
  readonly scenarioProof: ScenarioProofResult | undefined;
  readonly prNumber: number;
  /** Repository info for the PR — namespaces the R2 upload key. */
  readonly repoInfo: RepoIdentifier;
  /** ADW workflow ID (used as key namespace in R2). */
  readonly adwId: string;
  /** Injectable uploader (defaults to uploadToR2). */
  readonly uploader?: UploaderFn;
  /** Bound to the code host that owns the PR — `repoContext.codeHost.commentOnPullRequest`. */
  readonly commenter: CommenterFn;
}
