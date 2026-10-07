import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runScenarioProof } from '../scenarioProof';
import { APPLICATION_TYPE_PROFILES } from '../../core/applicationType';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Removes every directory the sandboxes of a test made; call it from an `afterEach`. */
export function removeSandboxes(): void {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

const PER_ISSUE_FEATURE = `Feature: Cart

  @adw-9921
  Scenario: The cart shows the total
    Given a cart

  @regression
  Scenario: The cart page loads
    Given a cart
`;

export interface Sandbox {
  readonly cwd: string;
  readonly proofDir: string;
  readonly recordsDir: string;
  /** Records, for the tag it is run with, the variables the runner was given. */
  readonly command: string;
}

export interface SandboxOptions {
  /** Whether a feature file carries the issue's tag. */
  readonly perIssueScenarios?: boolean;
  readonly stepDefinitions?: boolean;
}

export function makeSandbox({ perIssueScenarios = true, stepDefinitions = true }: SandboxOptions = {}): Sandbox {
  const cwd = makeTempDir('adw-proof-run-cwd-');
  if (stepDefinitions) {
    fs.mkdirSync(path.join(cwd, 'features', 'step_definitions'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'features', 'step_definitions', 'steps.ts'), '// steps\n');
  }
  if (perIssueScenarios) {
    fs.mkdirSync(path.join(cwd, 'features', 'per-issue'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'features', 'per-issue', 'feature-9921.feature'), PER_ISSUE_FEATURE);
  }
  const proofDir = makeTempDir('adw-proof-run-proof-');
  const recordsDir = makeTempDir('adw-proof-run-records-');
  const command = `printf '%s\\n' "$ADW_PROOF_DIR" "$ADW_JUNIT_REPORT_PATH" "$ADW_APPLICATION_URL" > '${recordsDir}/{tag}.txt'`;
  return { cwd, proofDir, recordsDir, command };
}

export interface Recorded {
  readonly proofDir: string;
  readonly reportPath: string;
  readonly applicationUrl: string;
}

export function recordedFor(sandbox: Sandbox, tag: string): Recorded {
  const [proofDir, reportPath, applicationUrl] = fs.readFileSync(path.join(sandbox.recordsDir, `${tag}.txt`), 'utf-8').split('\n');
  return { proofDir, reportPath, applicationUrl };
}

export function wasRun(sandbox: Sandbox, tag: string): boolean {
  return fs.existsSync(path.join(sandbox.recordsDir, `${tag}.txt`));
}

export interface RunOptions {
  env?: Record<string, string>;
  proofDirPerTag?: boolean;
  profile?: keyof typeof APPLICATION_TYPE_PROFILES;
  command?: string;
  featureDirectory?: string;
}

export function run(sandbox: Sandbox, { profile = 'cli', command = sandbox.command, featureDirectory = 'features', ...options }: RunOptions) {
  return runScenarioProof({
    scenariosMd: '# Scenarios\n',
    runByTagCommand: command,
    issueNumber: 9921,
    proofDir: sandbox.proofDir,
    cwd: sandbox.cwd,
    featureDirectory,
    applicationProfile: APPLICATION_TYPE_PROFILES[profile],
    ...options,
  });
}

export function proofDocument(sandbox: Sandbox): string {
  return fs.readFileSync(path.join(sandbox.proofDir, 'scenario_proof.md'), 'utf-8');
}
