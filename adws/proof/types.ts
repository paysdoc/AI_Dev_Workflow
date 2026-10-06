import type { TestCaseResult } from '../core/testReportParser';
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

/** An image of an `@adw-{issueNumber}` scenario, which is the visual evidence of the change. */
export interface PerIssueImage extends ProofArtifact {
  /** The JUnit test-case name of the scenario that took the image. */
  readonly scenario: string;
}

export interface TagProofResult {
  /** The fixed tag's pattern, e.g. `@regression`, `@adw-{issueNumber}`. */
  tag: string;
  /** Tag after `{issueNumber}` substitution, e.g. `@adw-273`. */
  resolvedTag: string;
  severity: 'blocker' | 'tech-debt';
  optional: boolean;
  /** True for a skipped tag. */
  passed: boolean;
  /** Stdout from the scenario run (truncated if over 10,000 chars). */
  output: string;
  exitCode: number | null;
  /** True when the tag was not run because no scenario in the feature files carries it. */
  skipped: boolean;
  /**
   * Optional explanation when scenario outcome and process exit code disagree —
   * e.g. JUnit report is clean but the subprocess exited non-zero due to
   * post-suite noise (D1 write failures, unhandled rejections in shutdown hooks).
   */
  warning?: string;
  /** Structured tally from the JUnit report (when report was present and parsed). */
  counts?: { total: number; passed: number; failed: number };
  /** Per-case results from the JUnit report (when report was present and parsed). */
  cases?: TestCaseResult[];
}

export interface ScenarioProofResult {
  tagResults: TagProofResult[];
  /** True when any non-skipped tag with severity `blocker` did not pass. */
  hasBlockerFailures: boolean;
  /**
   * The images the reviewer, the issue comment and the pull request comment show: per-issue scenario images only.
   * Always empty where the application profile expects no images.
   */
  perIssueImages: readonly PerIssueImage[];
  /** Absolute path to the written scenario proof markdown file. */
  resultsFilePath: string;
  /** Absolute path to the directory where BDD screenshot artifacts are written (ADW_PROOF_DIR). */
  artifactsDir: string;
}

export interface UploadedArtifact {
  /** The test-case name of the scenario the image shows. */
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

export interface UploadProofDeps {
  /** The images to upload, in order. */
  readonly images: readonly PerIssueImage[];
  /** Repository the images are uploaded for — namespaces the R2 bucket and public URL. */
  readonly repoInfo: RepoIdentifier;
  /** ADW workflow ID (used as key namespace in R2). */
  readonly adwId: string;
  /** Replaces R2 for this call; defaults to the installed test uploader, then the real `uploadToR2`. */
  readonly uploader?: UploaderFn;
}

export interface PublishDeps {
  /** Its `perIssueImages` are the images the comment shows. */
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
