import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BoundaryViolationKind } from '../../core/boundaryList';
import { describeBoundaryTagGate, runBoundaryTagGate, type BoundaryTagGate } from '../boundaryTagGate';

const ISSUE = 1139;
const SCENARIOS_MD = ['## Scenario Directory', 'features/', '', '## Real Boundaries', '- `cli` — a real command-line invocation', ''].join('\n');

const tmpDirs: string[] = [];

function makeTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function writeFile(base: string, relPath: string, content: string): void {
  const full = path.join(base, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

function scenarioFile(tags: string, name = 'Orders are listed'): string {
  return ['Feature: Orders', '', `  ${tags}`, `  Scenario: ${name}`, '    Given an order', ''].join('\n');
}

function worktree(scenariosMd: string | null, features: Readonly<Record<string, string>>): { worktreePath: string; proofDir: string } {
  const worktreePath = makeTmp('boundary-gate-worktree-');
  const proofDir = path.join(makeTmp('boundary-gate-proof-'), 'agents', 'test-id', 'scenario-test');
  if (scenariosMd !== null) writeFile(worktreePath, '.adw/scenarios.md', scenariosMd);
  for (const [relPath, content] of Object.entries(features)) writeFile(worktreePath, relPath, content);
  return { worktreePath, proofDir };
}

function run(paths: { worktreePath: string; proofDir: string }): BoundaryTagGate {
  return runBoundaryTagGate({ ...paths, featureDirectory: 'features', issueNumber: ISSUE });
}

function failed(gate: BoundaryTagGate): Extract<BoundaryTagGate, { kind: 'failed' }> {
  expect(gate.kind).toBe('failed');
  return gate as Extract<BoundaryTagGate, { kind: 'failed' }>;
}

describe('runBoundaryTagGate', () => {
  it("skips when the worktree's .adw/scenarios.md has no ## Real Boundaries list", () => {
    const paths = worktree('## Scenario Directory\nfeatures/\n', { 'features/orders.feature': scenarioFile('@adw-1139') });

    expect(run(paths)).toEqual({ kind: 'skipped' });
    expect(fs.existsSync(paths.proofDir)).toBe(false);
  });

  it('skips when the worktree has no .adw/scenarios.md', () => {
    const paths = worktree(null, { 'features/orders.feature': scenarioFile('@adw-1139') });

    expect(run(paths)).toEqual({ kind: 'skipped' });
  });

  it('passes, with the declared boundaries, when every @adw-N scenario of the feature directory carries a declared tag', () => {
    const paths = worktree(SCENARIOS_MD, {
      'features/per-issue/feature-1139.feature': scenarioFile('@adw-1139 @boundary-cli'),
      'features/regression/orders.feature': scenarioFile('@regression', 'Orders are accepted'),
    });

    expect(run(paths)).toEqual({ kind: 'passed', boundaries: [{ name: 'cli', description: 'a real command-line invocation' }] });
    expect(fs.existsSync(paths.proofDir)).toBe(false);
  });

  it('fails a scenario without a boundary tag: a blocker result of the per-issue tag, with no exit code, whose output names the scenario and the declared boundaries', () => {
    const paths = worktree(SCENARIOS_MD, { 'features/per-issue/feature-1139.feature': scenarioFile('@adw-1139') });

    const gate = failed(run(paths));

    expect(gate.violations).toEqual([{ kind: BoundaryViolationKind.MissingTag, featurePath: 'per-issue/feature-1139.feature', scenario: 'Orders › Orders are listed' }]);
    expect(gate.proof.hasBlockerFailures).toBe(true);
    expect(gate.proof.perIssueImages).toEqual([]);
    expect(gate.proof.tagResults).toHaveLength(1);
    const [result] = gate.proof.tagResults;
    expect(result).toMatchObject({ tag: '@adw-{issueNumber}', resolvedTag: '@adw-1139', severity: 'blocker', optional: true, passed: false, skipped: false, exitCode: null });
    expect(result.warning).toBe('The boundary-tag check failed, so no scenario ran');
    expect(result.output.split('\n')).toEqual([
      'Every scenario tagged @adw-1139 must carry the tag @boundary-<name> of a Real Boundary declared under ## Real Boundaries in .adw/scenarios.md.',
      'Declared boundaries: cli',
      '`per-issue/feature-1139.feature`: scenario "Orders › Orders are listed" carries no boundary tag',
      "Fix: add or correct the @boundary-<name> tag on the scenario's tag line to the declared boundary its step code drives; add an entry under ## Real Boundaries only when the issue itself creates that boundary.",
    ]);
  });

  it('fails an undeclared tag and lists the malformed entries of the list in the output', () => {
    const scenariosMd = ['## Real Boundaries', '- **browser** — a real browser', ''].join('\n');
    const paths = worktree(scenariosMd, { 'features/orders.feature': scenarioFile('@adw-1139 @boundary-browser') });

    const gate = failed(run(paths));

    expect(gate.violations).toEqual([
      { kind: BoundaryViolationKind.UndeclaredTag, featurePath: 'orders.feature', scenario: 'Orders › Orders are listed', tag: '@boundary-browser' },
    ]);
    const [result] = gate.proof.tagResults;
    expect(result.output).toContain('Declared boundaries: none');
    expect(result.output).toContain('Entry under ## Real Boundaries that names no boundary: - **browser** — a real browser');
    expect(result.output).toContain('`orders.feature`: scenario "Orders › Orders are listed" carries @boundary-browser, which names no boundary under ## Real Boundaries');
  });

  it('writes scenario_proof.md to the proof directory, saying no scenario ran and listing the violations', () => {
    const paths = worktree(SCENARIOS_MD, { 'features/orders.feature': scenarioFile('@adw-1139') });

    const gate = failed(run(paths));

    expect(gate.proof.resultsFilePath).toBe(path.resolve(paths.proofDir, 'scenario_proof.md'));
    expect(gate.proof.artifactsDir).toBe(path.resolve(paths.proofDir, 'artifacts'));
    const document = fs.readFileSync(gate.proof.resultsFilePath, 'utf-8');
    expect(document).toContain('The boundary-tag check failed, so no scenario ran');
    expect(document).toContain('## @adw-1139 Scenarios (severity: blocker)');
    expect(document).toContain('scenario "Orders › Orders are listed" carries no boundary tag');
  });

  it('reads the list as the worktree holds it at each call, so an entry added after a failure passes the next call', () => {
    const paths = worktree(SCENARIOS_MD, { 'features/orders.feature': scenarioFile('@adw-1139 @boundary-browser') });
    expect(run(paths).kind).toBe('failed');

    writeFile(paths.worktreePath, '.adw/scenarios.md', `${SCENARIOS_MD}- \`browser\` — a real browser\n`);

    expect(run(paths).kind).toBe('passed');
  });
});

describe('describeBoundaryTagGate', () => {
  it('describeBoundaryTagGate says skipped, passed with the declared names, or failed with the number of violations', () => {
    const paths = worktree(SCENARIOS_MD, { 'features/orders.feature': scenarioFile('@adw-1139') });
    const failure = failed(run(paths));
    const passed: BoundaryTagGate = {
      kind: 'passed',
      boundaries: [
        { name: 'cli', description: 'a real command-line invocation' },
        { name: 'browser', description: 'a real browser' },
      ],
    };

    expect(describeBoundaryTagGate({ kind: 'skipped' }, ISSUE)).toBe(
      'Scenario test phase: .adw/scenarios.md has no ## Real Boundaries list — boundary-tag check skipped',
    );
    expect(describeBoundaryTagGate(passed, ISSUE)).toBe('Scenario test phase: the boundary tags of the @adw-1139 scenarios name declared boundaries (cli, browser)');
    expect(describeBoundaryTagGate(failure, ISSUE)).toBe('Scenario test phase: boundary-tag check failed with 1 violation(s); no scenario ran');
  });
});
