import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runScenarioProof } from '../scenarioProof';
import { getDefaultReviewProofConfig } from '../../core/projectConfig';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

interface Sandbox {
  readonly cwd: string;
  readonly proofDir: string;
  readonly recordsDir: string;
  /** Records, for the tag it is run with, the variables the runner was given. */
  readonly command: string;
}

function makeSandbox(): Sandbox {
  const cwd = makeTempDir('adw-proof-run-cwd-');
  fs.mkdirSync(path.join(cwd, 'features', 'step_definitions'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'features', 'step_definitions', 'steps.ts'), '// steps\n');
  const proofDir = makeTempDir('adw-proof-run-proof-');
  const recordsDir = makeTempDir('adw-proof-run-records-');
  const command = `printf '%s\\n' "$ADW_PROOF_DIR" "$ADW_JUNIT_REPORT_PATH" "$ADW_APPLICATION_URL" > '${recordsDir}/{tag}.txt'`;
  return { cwd, proofDir, recordsDir, command };
}

interface Recorded {
  readonly proofDir: string;
  readonly reportPath: string;
  readonly applicationUrl: string;
}

function recordedFor(sandbox: Sandbox, tag: string): Recorded {
  const [proofDir, reportPath, applicationUrl] = fs.readFileSync(path.join(sandbox.recordsDir, `${tag}.txt`), 'utf-8').split('\n');
  return { proofDir, reportPath, applicationUrl };
}

function run(sandbox: Sandbox, options: { env?: Record<string, string>; proofDirPerTag?: boolean }) {
  return runScenarioProof({
    scenariosMd: '# Scenarios\n',
    reviewProofConfig: getDefaultReviewProofConfig(),
    runByTagCommand: sandbox.command,
    issueNumber: 9921,
    proofDir: sandbox.proofDir,
    cwd: sandbox.cwd,
    ...options,
  });
}

describe('runScenarioProof — the environment of a run', () => {
  it('hands the extra variables to the command, for every tag', async () => {
    const sandbox = makeSandbox();

    await run(sandbox, { env: { ADW_APPLICATION_URL: 'http://localhost:4567' } });

    expect(recordedFor(sandbox, 'regression').applicationUrl).toBe('http://localhost:4567');
    expect(recordedFor(sandbox, 'adw-9921').applicationUrl).toBe('http://localhost:4567');
  });

  it('hands none when none are given', async () => {
    const sandbox = makeSandbox();

    await run(sandbox, {});

    expect(recordedFor(sandbox, 'adw-9921').applicationUrl).toBe('');
  });

  it('lets the extra variables override neither the report path nor the proof directory', async () => {
    const sandbox = makeSandbox();

    const result = await run(sandbox, { env: { ADW_PROOF_DIR: '/elsewhere', ADW_JUNIT_REPORT_PATH: '/elsewhere/report.xml' } });

    const recorded = recordedFor(sandbox, 'adw-9921');
    expect(recorded.reportPath).toBe(path.join(sandbox.proofDir, 'junit-adw-9921.xml'));
    expect(recorded.proofDir).toBe(result.artifactsDir);
  });

  it('keeps the reports outside the artifacts directory, whatever the proof directory mode', async () => {
    const sandbox = makeSandbox();

    const result = await run(sandbox, { proofDirPerTag: true });

    for (const tag of ['regression', 'adw-9921']) {
      expect(path.dirname(recordedFor(sandbox, tag).reportPath)).toBe(sandbox.proofDir);
    }
    expect(result.artifactsDir).toBe(path.join(sandbox.proofDir, 'artifacts'));
  });
});

describe('runScenarioProof — the proof directory of a run', () => {
  it('shares the artifacts directory between tags by default, as before', async () => {
    const sandbox = makeSandbox();

    const result = await run(sandbox, {});

    expect(recordedFor(sandbox, 'regression').proofDir).toBe(result.artifactsDir);
    expect(recordedFor(sandbox, 'adw-9921').proofDir).toBe(result.artifactsDir);
  });

  it('gives each tag a directory of its own inside the artifacts directory with proofDirPerTag', async () => {
    const sandbox = makeSandbox();

    const result = await run(sandbox, { proofDirPerTag: true });

    const regression = recordedFor(sandbox, 'regression').proofDir;
    const issue = recordedFor(sandbox, 'adw-9921').proofDir;
    expect(regression).toBe(path.join(result.artifactsDir, 'regression'));
    expect(issue).toBe(path.join(result.artifactsDir, 'adw-9921'));
    expect(regression).not.toBe(issue);
  });

  it('returns the artifacts directory itself as the root to harvest, in both modes', async () => {
    const shared = makeSandbox();
    const perTag = makeSandbox();

    const sharedResult = await run(shared, {});
    const perTagResult = await run(perTag, { proofDirPerTag: true });

    expect(sharedResult.artifactsDir).toBe(path.join(shared.proofDir, 'artifacts'));
    expect(perTagResult.artifactsDir).toBe(path.join(perTag.proofDir, 'artifacts'));
  });
});
