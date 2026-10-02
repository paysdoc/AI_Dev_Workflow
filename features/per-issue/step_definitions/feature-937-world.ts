/**
 * State shared by the feature-937 step files, rebuilt before every scenario. The recording issue
 * tracker and the stand-in screenshot store live here because every Then step reads what they received.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { DataTable } from '@cucumber/cucumber';
import { Platform } from '@paysdoc/devplatform';
import type { CodeHost, IssueTracker } from '@paysdoc/devplatform';

import { AGENTS_STATE_DIR } from '../../../adws/core/config.ts';
import type { UploaderFn } from '../../../adws/proof/types.ts';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';

export const REPO_ID = { owner: 'acme', repo: 'widgets', platform: Platform.GitHub } as const;

const STORE_ORIGIN = 'https://screenshots.example.test';

/** Bytes unique to one relative path, so an upload can be traced back to the file it carried. */
export function fixtureBytes(relPath: string): Buffer {
  return Buffer.from(`fixture bytes of ${relPath}`);
}

/** The relative paths listed in the `screenshot` column of a scenario table. */
export function screenshotsIn(table: DataTable): string[] {
  return table.hashes().map(row => row['screenshot']);
}

export interface RecordedComment {
  readonly issueNumber: number;
  readonly body: string;
}

export interface RecordedUpload {
  readonly key: string;
  readonly bytes: Buffer;
  /** The URL the store answered with; null when it refused the upload. */
  readonly url: string | null;
}

export interface ScreenshotStore {
  readonly uploads: readonly RecordedUpload[];
  readonly uploader: UploaderFn;
  refuse(relPath: string): void;
}

function toBuffer(body: Parameters<UploaderFn>[0]['body']): Buffer {
  if (body instanceof Uint8Array) return Buffer.from(body);
  throw new Error('The stand-in screenshot store only takes uploads whose body is held in memory');
}

export function createScreenshotStore(): ScreenshotStore {
  const uploads: RecordedUpload[] = [];
  const refusedBytes: Buffer[] = [];

  const uploader: UploaderFn = async ({ owner, repo, key, body }) => {
    const bytes = toBuffer(body);
    const refused = refusedBytes.some(candidate => candidate.equals(bytes));
    const url = refused ? null : `${STORE_ORIGIN}/${uploads.length + 1}/${key}`;
    uploads.push({ key, bytes, url });
    if (url === null) throw new Error('The stand-in screenshot store refused this upload');
    return { url, bucket: `${owner}-${repo}`, key };
  };

  return { uploads, uploader, refuse: relPath => { refusedBytes.push(fixtureBytes(relPath)); } };
}

/** What the scenario command copies into the proof directory on every run, relative to that directory. */
export interface ProofRun {
  readonly screenshots: readonly string[];
  readonly otherFiles: readonly string[];
}

export interface ReviewWorkflow {
  readonly config: WorkflowConfig;
  readonly issueNumber: number;
  readonly adwId: string;
  readonly worktreePath: string;
  readonly proofRunDir: string;
}

export type ReviewOutcome =
  | { readonly returned: true; readonly reviewPassed: boolean }
  | { readonly returned: false; readonly failure: string };

export interface StandInVerdict {
  /** The blocker the stand-in review agent reports; null when it passes the review. */
  readonly blocker: string | null;
}

export interface World937 {
  store: ScreenshotStore | null;
  workflow: ReviewWorkflow | null;
  proofRun: ProofRun;
  verdict: StandInVerdict | null;
  listsProofFile: boolean;
  comments: RecordedComment[];
  codeHostCalls: string[];
  outcome: ReviewOutcome | null;
  claudeCodePath: { readonly previous: string | undefined } | null;
  adwIds: string[];
  tempDirs: string[];
}

function freshWorld(): World937 {
  return {
    store: null,
    workflow: null,
    proofRun: { screenshots: [], otherFiles: [] },
    verdict: null,
    listsProofFile: false,
    comments: [],
    codeHostCalls: [],
    outcome: null,
    claudeCodePath: null,
    adwIds: [],
    tempDirs: [],
  };
}

export const world: World937 = freshWorld();

export function resetWorld(): void {
  Object.assign(world, freshWorld());
}

export function requireStore(): ScreenshotStore {
  assert.ok(world.store, 'Expected the Background to have prepared the screenshot store');
  return world.store;
}

export function requireWorkflow(): ReviewWorkflow {
  assert.ok(world.workflow, 'Expected a review workflow to have been built first');
  return world.workflow;
}

export function recordingIssueTracker(): Pick<IssueTracker, 'commentOnIssue' | 'fetchLabels'> {
  return {
    commentOnIssue: (issueNumber, body) => { world.comments.push({ issueNumber, body }); },
    fetchLabels: () => [],
  };
}

// The review runs before the pull request exists, so nothing is expected here; whatever is called is recorded.
export function recordingCodeHost(): CodeHost {
  return new Proxy({} as CodeHost, {
    get: (_target, operation) => {
      if (operation === 'then') return undefined;
      return () => { world.codeHostCalls.push(String(operation)); };
    },
  });
}

export function removeScenarioArtefacts(): void {
  world.adwIds.forEach(adwId => fs.rmSync(path.join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true }));
  world.tempDirs.forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
}
