import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'child_process';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Contract guard: the daily regression run reports the suite's own result. The workflow has a
 * `host` job and a `docker` job, each with its own time budget and its own `if:`, and the host
 * scenarios step ends with Cucumber's exit status. The docker job installs on the runner first,
 * because the container's `node_modules` volume needs a mount point inside the read-only checkout,
 * and the image runs the suite in a `cp -R` copy of that checkout, which is writable and belongs
 * to the container user.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const HOST_STEP_NAME = 'Run @regression scenarios';
const HOST_COMMAND = 'NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"';
const DOCKER_COMMAND = 'bash test/docker-run.sh --tags "@regression"';

const readRepoFile = (file: string): string => fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8');
const indentOf = (line: string): number => line.length - line.trimStart().length;
const isBlank = (line: string): boolean => line.trim() === '';
const countOf = (text: string, part: string): number => text.split(part).length - 1;

const workflow = readRepoFile('.github/workflows/regression.yml');
const dockerRunScript = readRepoFile('test/docker-run.sh');
const dockerfile = readRepoFile('test/Dockerfile');
const jobs = workflow.slice(workflow.indexOf('jobs:')).split(/^ {2}(?=[\w-]+:\n)/m).slice(1);

const jobIdOf = (job: string): string => job.slice(0, job.indexOf(':'));
const jobNamed = (id: string): string => jobs.find(job => jobIdOf(job) === id) ?? '';
const stepsOf = (job: string): string[] => job.split(/^ {6}- name: /m).slice(1);
const stepNamed = (job: string, name: string): string => stepsOf(job).find(step => step.split('\n')[0] === name) ?? '';
const ifOf = (runtime: string): string => `if: \${{ github.event_name == 'schedule' || github.event.inputs.runtime == '${runtime}' }}`;

/** The lines of a block scalar: those up to the first non-blank line indented less than the block, with its indentation removed. */
function blockScalar(lines: readonly string[]): string {
  const first = lines.find(line => !isBlank(line));
  if (first === undefined) return '';
  const indent = indentOf(first);
  const end = lines.findIndex(line => !isBlank(line) && indentOf(line) < indent);
  return (end === -1 ? lines : lines.slice(0, end)).map(line => line.slice(indent)).join('\n');
}

/** The `run:` value of a step, written inline (`run: cmd`) or as a block (`run: |`); empty for a step that has none. */
function readRunScript(step: string): string {
  const lines = step.split('\n');
  const runIndex = lines.findIndex(line => /^\s+run:/.test(line));
  if (runIndex === -1) return '';

  const inline = lines[runIndex].replace(/^\s+run:\s*/, '');
  return inline.startsWith('|') ? blockScalar(lines.slice(runIndex + 1)) : inline;
}

const hostJob = jobNamed('host');
const dockerJob = jobNamed('docker');
const hostStep = stepNamed(hostJob, HOST_STEP_NAME);
const hostScript = readRunScript(hostStep);

let fakeBinDir = '';

beforeAll(() => {
  fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-regression-workflow-'));
  fs.writeFileSync(path.join(fakeBinDir, 'bunx'), '#!/bin/sh\nexit "${FAKE_BUNX_EXIT:-0}"\n', { mode: 0o755 });
});

afterAll(() => {
  fs.rmSync(fakeBinDir, { recursive: true, force: true });
});

/** Actions runs a `run` step that names no `shell` as `bash -e`. */
function runHostStep(cucumberExit: number): SpawnSyncReturns<string> {
  expect(hostScript, `the host job has no "${HOST_STEP_NAME}" step with a run script`).not.toBe('');
  const env: NodeJS.ProcessEnv = {
    PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
    FAKE_BUNX_EXIT: String(cucumberExit),
  };
  return spawnSync('bash', ['-e', '-c', hostScript], { env, encoding: 'utf-8' });
}

describe('regression.yml', () => {
  it('has a host job and then a docker job, each with a 30-minute timeout', () => {
    expect(jobs.map(jobIdOf)).toEqual(['host', 'docker']);
    jobs.forEach(job => expect(job).toContain('timeout-minutes: 30'));
  });

  it('runs the host job on the schedule and for the host runtime', () => {
    expect(hostJob).toContain(ifOf('host'));
  });

  it('runs the docker job on the schedule and for the docker runtime', () => {
    expect(dockerJob).toContain(ifOf('docker'));
  });

  it('runs Cucumber in the host scenarios step with nothing that swallows its exit status', () => {
    expect(hostScript).toContain(HOST_COMMAND);
    expect(hostStep).not.toMatch(/set \+e|exit 0|continue-on-error/);
  });

  it('fails the host scenarios step when Cucumber exits non-zero', () => {
    expect(runHostStep(1).status).toBe(1);
  });

  it('passes the host scenarios step when Cucumber exits 0', () => {
    expect(runHostStep(0).status).toBe(0);
  });

  it.each(['Report results', 'Upload results artifact'])('runs the host step "%s" whatever the suite said', name => {
    expect(stepNamed(hostJob, name)).toContain('if: always()');
  });

  it('uploads the results with the v4 artifact action', () => {
    expect(stepNamed(hostJob, 'Upload results artifact')).toContain('uses: actions/upload-artifact@v4');
  });

  it('installs on the runner before the container run, so the node_modules mount point exists inside the read-only checkout', () => {
    const install = dockerJob.indexOf('run: bun install');
    const containerRun = dockerJob.indexOf(`run: ${DOCKER_COMMAND}`);
    expect(install).toBeGreaterThan(-1);
    expect(containerRun).toBeGreaterThan(install);
  });
});

describe('the Docker leg', () => {
  it('mounts the checkout read-only and gives node_modules an anonymous volume, in the shell and the run path alike', () => {
    expect(countOf(dockerRunScript, '-v "${REPO_ROOT}:/workspace:ro"')).toBe(2);
    expect(countOf(dockerRunScript, '-v /workspace/node_modules')).toBe(2);
  });

  describe('the image command', () => {
    const command = dockerfile.split('\n').find(line => line.startsWith('CMD ')) ?? '';

    it('copies the read-only mount with cp -R, which leaves the copy owned by the container user', () => {
      expect(command).toContain('cp -R /workspace/. /tmp/bdd/workspace');
      expect(command).not.toContain('cp -a');
    });

    it('copies, then enters the copy, installs there, and only then runs Cucumber', () => {
      const positions = ['cp -R', 'cd /tmp/bdd/workspace', 'bun install --frozen-lockfile', 'cucumber-js'].map(part => command.indexOf(part));
      expect(positions.every(position => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
    });
  });
});
