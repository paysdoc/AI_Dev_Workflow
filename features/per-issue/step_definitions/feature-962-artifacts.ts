/**
 * `actions/upload-artifact` as v4 runs it, for the scenarios: the files its `path` names in the
 * checkout of the job that uses it are stored under its `name`, a name stores once per run, and
 * `if-no-files-found` is honoured (warn, error or ignore). A `path` with a wildcard or outside the
 * checkout, and a `with:` key the handler does not know, throw, so an unexpected edit fails loudly
 * instead of being misread.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { ActionHandler, ActionRequest } from './feature-939-runner.ts';
import { annotationsIn, type ScriptOutcome } from './feature-939-stepProcess.ts';

export interface StoredFile {
  /** Relative to the checkout of the job that stored it. */
  readonly path: string;
  readonly content: string;
}

export interface StoredArtifact {
  readonly name: string;
  readonly jobId: string;
  readonly files: readonly StoredFile[];
}

type IfNoFilesFound = 'warn' | 'error' | 'ignore';

interface UploadInputs {
  readonly name: string;
  readonly paths: readonly string[];
  readonly ifNoFilesFound: IfNoFilesFound;
}

const KNOWN_INPUTS = new Set(['name', 'path', 'if-no-files-found']);
const NO_FILES_POLICIES: readonly IfNoFilesFound[] = ['warn', 'error', 'ignore'];
const WILDCARD = /[*?[\]{}!]/;
const CONFLICT = 'Failed to CreateArtifact: Received non-retryable error: Failed request: (409) Conflict: an artifact with this name already exists on the workflow run\n';

const unsupported = (detail: string): Error => new Error(`Unsupported workflow syntax: ${detail}`);

function outcome(passed: boolean, stdout: string, stderr = ''): ScriptOutcome {
  return { passed, stdout, stderr, annotations: annotationsIn(stdout), env: new Map(), outputs: new Map(), path: [] };
}

function pathEntry(entry: string): string {
  const normalized = path.normalize(entry);
  if (WILDCARD.test(entry)) throw unsupported(`an artifact path with a wildcard: ${entry}`);
  if (path.isAbsolute(normalized) || normalized.startsWith('..')) throw unsupported(`an artifact path outside the checkout: ${entry}`);
  return normalized;
}

function readInputs(inputs: ReadonlyMap<string, string>): UploadInputs {
  const unknown = [...inputs.keys()].find(key => !KNOWN_INPUTS.has(key));
  if (unknown !== undefined) throw unsupported(`upload-artifact with the input "${unknown}"`);

  const policy = inputs.get('if-no-files-found') ?? 'warn';
  const ifNoFilesFound = NO_FILES_POLICIES.find(candidate => candidate === policy);
  if (ifNoFilesFound === undefined) throw unsupported(`upload-artifact with if-no-files-found: ${policy}`);

  const paths = (inputs.get('path') ?? '').split('\n').map(line => line.trim()).filter(line => line !== '').map(pathEntry);
  if (paths.length === 0) throw unsupported('upload-artifact with no path');
  return { name: inputs.get('name') ?? 'artifact', paths, ifNoFilesFound };
}

/** A path that names a file is that file, and one that names a directory is every file under it. */
function filesNamedBy(checkoutDir: string, entry: string): string[] {
  const absolute = path.join(checkoutDir, entry);
  const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
  if (stat === undefined) return [];
  if (!stat.isDirectory()) return [entry];
  return fs.readdirSync(absolute).flatMap(child => filesNamedBy(checkoutDir, path.join(entry, child)));
}

function noFilesOutcome(input: UploadInputs): ScriptOutcome {
  if (input.ifNoFilesFound === 'ignore') return outcome(true, '');
  const message = `No files were found with the provided path: ${input.paths.join(', ')}. No artifacts will be uploaded.`;
  return input.ifNoFilesFound === 'error' ? outcome(false, `::error::${message}\n`) : outcome(true, `::warning::${message}\n`);
}

function upload(store: StoredArtifact[], request: ActionRequest): ScriptOutcome {
  const input = readInputs(request.inputs);
  const files = input.paths
    .flatMap(entry => filesNamedBy(request.checkoutDir, entry))
    .map((file): StoredFile => ({ path: file, content: fs.readFileSync(path.join(request.checkoutDir, file), 'utf-8') }));
  if (files.length === 0) return noFilesOutcome(input);
  if (store.some(artifact => artifact.name === input.name)) return outcome(false, '', CONFLICT);

  store.push({ name: input.name, jobId: request.jobId, files });
  return outcome(true, `Artifact ${input.name} has been successfully uploaded.\n`);
}

/** The `actions/upload-artifact` handler of a run: what it uploads goes into `store`, oldest first. */
export const artifactUploader = (store: StoredArtifact[]): ActionHandler => request => upload(store, request);

interface ReportedStep {
  readonly keyword?: string;
  readonly hidden?: boolean;
  readonly result?: { readonly status?: string };
}

interface ReportedFeature {
  readonly elements?: readonly { readonly steps?: readonly ReportedStep[] }[];
}

const isHook = (step: ReportedStep): boolean => step.hidden === true || step.keyword === 'Before' || step.keyword === 'After';

function parseReport(content: string): readonly ReportedFeature[] | undefined {
  try {
    const parsed: unknown = JSON.parse(content);
    return Array.isArray(parsed) ? (parsed as readonly ReportedFeature[]) : undefined;
  } catch {
    return undefined;
  }
}

/** The status of every step of every scenario of a Cucumber JSON report, hooks aside; `undefined` for a file that is no such report. */
export function reportedStepStatuses(content: string): readonly string[] | undefined {
  const features = parseReport(content);
  if (features === undefined) return undefined;
  return features
    .flatMap(feature => feature.elements ?? [])
    .flatMap(scenario => scenario.steps ?? [])
    .filter(step => !isHook(step))
    .map(step => step.result?.status ?? 'no status');
}
