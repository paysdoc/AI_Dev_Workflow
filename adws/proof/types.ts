/**
 * Shared types for the proof layer module.
 */

import type { TagProofResult, ScenarioProofResult } from '../phases/scenarioProof';
import type { UploadOptions, UploadResult } from '../r2/types';
import type { RepoInfo } from '../github/githubApi';

/** A single image artifact discovered in the proof directory. */
export interface ProofArtifact {
  /** Absolute path to the image file on disk. */
  readonly absPath: string;
  /**
   * Path relative to the harvest root, POSIX-normalised (forward slashes).
   * Used to derive the scenario group key (leading path segment).
   */
  readonly relPath: string;
}

/** An artifact successfully uploaded to R2. */
export interface UploadedArtifact {
  /** Scenario group key (leading path segment of relPath, or 'Screenshots' for flat files). */
  readonly scenario: string;
  /** Public R2 URL for the image. */
  readonly url: string;
  /** File name (basename of relPath). */
  readonly fileName: string;
}

/**
 * Subset of TagProofResult fields the proof-comment formatter needs.
 * Using Pick to stay in sync with the source type.
 */
export type TagProofResultLike = Pick<
  TagProofResult,
  'resolvedTag' | 'severity' | 'passed' | 'skipped' | 'counts'
>;

/** Input to the pure proof-comment formatter. */
export interface ProofCommentInput {
  readonly tagResults: readonly TagProofResultLike[];
  readonly uploaded: readonly UploadedArtifact[];
  readonly r2Configured: boolean;
}

/** Injected uploader function (defaults to the real `uploadToR2`). */
export type UploaderFn = (options: UploadOptions) => Promise<UploadResult>;

/** Injected commenter function (defaults to the real `commentOnPR`). */
export type CommenterFn = (prNumber: number, body: string, repoInfo: RepoInfo) => void;

/** Everything `publishPrProof` needs — inject uploader/commenter to keep it testable. */
export interface PublishDeps {
  /** Absolute path to the artifacts directory (from ScenarioProofResult.artifactsDir). */
  readonly artifactsDir: string | undefined;
  /** The full scenario proof result (for tagResults). */
  readonly scenarioProof: ScenarioProofResult | undefined;
  /** PR number to post the comment to. */
  readonly prNumber: number;
  /** Repository info for the PR. */
  readonly repoInfo: RepoInfo;
  /** ADW workflow ID (used as key namespace in R2). */
  readonly adwId: string;
  /** Injectable uploader (defaults to uploadToR2). */
  readonly uploader?: UploaderFn;
  /** Injectable commenter (defaults to commentOnPR). */
  readonly commenter?: CommenterFn;
}
