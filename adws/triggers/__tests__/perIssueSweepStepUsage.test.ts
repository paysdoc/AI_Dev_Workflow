import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runShellCommand, type ProcessOutcome, type ProcessRunner } from '../../core/checkRunner';
import { UNUSED_STEP_ISSUE_MARKER, type UnusedStepIssueRef, type UnusedStepIssueSpec } from '../../core/unusedStepIssueBody';
import { REPORT_PATH_PLACEHOLDER, resolveStepUsageReader, type StepUsageReader, type UnusedStepDefinition } from '../../core/unusedStepReport';
import {
  defaultFileRemovalIssue,
  defaultListOpenRemovalIssues,
  defaultReadStepUsage,
  reconcileUnusedStepIssue,
  runStepUsageReport,
  type ReconcileUnusedStepIssueDeps,
} from '../perIssueSweepStepUsage';

const STEP_FILE = 'features/step_definitions/orders.steps.ts';
const ONE_DEFINITION = JSON.stringify([{ matches: [], code: 'function(){}', line: 3, pattern: 'an order is placed', patternType: 'CucumberExpression', uri: STEP_FILE }]);
const UNKNOWN_DEFINITION = JSON.stringify([{ matches: [], code: 'function(){}', line: 0, pattern: 'a generated step', patternType: 'CucumberExpression', uri: 'unknown' }]);
const UNUSED: readonly UnusedStepDefinition[] = [
  { file: STEP_FILE, line: 3, pattern: 'an order is placed' },
  { file: 'features/step_definitions/invoices.steps.ts', line: 6, pattern: 'the invoice is sent' },
];

let worktree: string;

beforeEach(() => {
  worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-step-usage-test-'));
  fs.mkdirSync(path.join(worktree, 'features/step_definitions'), { recursive: true });
  fs.writeFileSync(path.join(worktree, STEP_FILE), "Given('an order is placed', () => {});\n");
});

afterEach(() => {
  fs.rmSync(worktree, { recursive: true, force: true });
});

function cucumberJs(): StepUsageReader {
  const lookup = resolveStepUsageReader('cucumber-js');
  if (lookup.kind !== 'supported') throw new Error('expected the cucumber-js reader');
  return lookup.reader;
}

/** The real cucumber-js reader, with a dry run that is a plain shell command. */
function readerRunning(command: string): StepUsageReader {
  return { ...cucumberJs(), framework: 'cucumber-js', dryRunCommand: () => command };
}

/** Records each command and its directory, then runs it for real. */
function recordingRunner(): { readonly calls: { command: string; cwd: string }[]; readonly run: ProcessRunner } {
  const calls: { command: string; cwd: string }[] = [];
  return { calls, run: (command, cwd) => (calls.push({ command, cwd }), runShellCommand(command, cwd)) };
}

function reportDirectoryOf(command: string): string {
  const match = /'([^']*usage\.json)'/.exec(command);
  if (!match) throw new Error(`no quoted report path in: ${command}`);
  return path.dirname(match[1]);
}

const writeReport = (json: string): string => `printf '%s' '${json}' > ${REPORT_PATH_PLACEHOLDER}`;

describe('runStepUsageReport', () => {
  it('installs dependencies, runs the derived dry run in the worktree with the report path substituted, and returns the usage it wrote', async () => {
    const { calls, run } = recordingRunner();

    const outcome = await runStepUsageReport({
      worktreePath: worktree,
      commands: { installDeps: 'printf installed > installed.marker', runScenariosByTag: 'cucumber-js --tags "@{tag}"' },
      reader: readerRunning(`test -f installed.marker && printf '[]' > ${REPORT_PATH_PLACEHOLDER}`),
      runProcess: run,
    });

    expect(outcome).toEqual({ kind: 'usage', framework: 'cucumber-js', usages: [] });
    expect(calls.map((call) => call.cwd)).toEqual([worktree, worktree]);
    expect(calls[0].command).toBe('printf installed > installed.marker');
    expect(calls[1].command).not.toContain(REPORT_PATH_PLACEHOLDER);
    const reportPath = /> '([^']*)'$/.exec(calls[1].command)?.[1] ?? '';
    expect(reportPath.startsWith(os.tmpdir())).toBe(true);
    expect(path.basename(reportPath)).toBe('usage.json');
  });

  it('skips the install when ## Install Dependencies is N/A', async () => {
    const { calls, run } = recordingRunner();

    const outcome = await runStepUsageReport({ worktreePath: worktree, commands: { installDeps: 'N/A', runScenariosByTag: '' }, reader: readerRunning(writeReport(ONE_DEFINITION)), runProcess: run });

    expect(calls).toHaveLength(1);
    expect(outcome).toEqual({ kind: 'usage', framework: 'cucumber-js', usages: [{ file: STEP_FILE, line: 3, pattern: 'an order is placed', usedBy: [] }] });
  });

  it('returns unavailable, naming the command and exit code, when the install fails, and never runs the dry run', async () => {
    const runProcess = vi.fn(async (): Promise<ProcessOutcome> => ({ exitCode: 1, output: 'resolution failed' }));

    const outcome = await runStepUsageReport({ worktreePath: worktree, commands: { installDeps: 'bun install', runScenariosByTag: '' }, reader: readerRunning('true'), runProcess });

    expect(outcome).toEqual({ kind: 'unavailable', detail: expect.stringContaining('`bun install` exited 1') });
    expect(runProcess).toHaveBeenCalledTimes(1);
  });

  it('returns unavailable with the exit code and the tail of the output when the dry run writes no report', async () => {
    const lines = Array.from({ length: 30 }, (_, index) => `output line ${index + 1}`).join('\n');
    const runProcess = vi.fn(async (): Promise<ProcessOutcome> => ({ exitCode: 3, output: `${lines}\n` }));

    const outcome = await runStepUsageReport({ worktreePath: worktree, commands: { installDeps: 'N/A', runScenariosByTag: '' }, reader: readerRunning('cucumber-js --dry-run'), runProcess });

    expect(outcome.kind).toBe('unavailable');
    const detail = outcome.kind === 'unavailable' ? outcome.detail : '';
    expect(detail).toContain('exit 3');
    expect(detail).toContain('output line 30');
    expect(detail).toContain('output line 11');
    expect(detail).not.toContain('output line 10\n');
  });

  it('returns unavailable when ## Run Scenarios by Tag has no {tag} filter to replace', async () => {
    const runProcess = vi.fn();

    const outcome = await runStepUsageReport({ worktreePath: worktree, commands: { installDeps: 'bun install', runScenariosByTag: 'npx playwright test' }, reader: cucumberJs(), runProcess });

    expect(outcome).toEqual({ kind: 'unavailable', detail: '`## Run Scenarios by Tag` has no `{tag}` filter to replace' });
    expect(runProcess).not.toHaveBeenCalled();
  });

  it('returns unavailable for an unreadable report', async () => {
    const outcome = await runStepUsageReport({ worktreePath: worktree, commands: { installDeps: 'N/A', runScenariosByTag: '' }, reader: readerRunning(writeReport('not json')) });

    expect(outcome).toEqual({ kind: 'unavailable', detail: expect.stringContaining('not JSON') });
  });

  it('returns unavailable when a reported step-definition file is not in the worktree, and accepts a definition whose file cucumber reports as unknown', async () => {
    fs.rmSync(path.join(worktree, STEP_FILE));
    const commands = { installDeps: 'N/A', runScenariosByTag: '' };

    const missing = await runStepUsageReport({ worktreePath: worktree, commands, reader: readerRunning(writeReport(ONE_DEFINITION)) });
    const unknown = await runStepUsageReport({ worktreePath: worktree, commands, reader: readerRunning(writeReport(UNKNOWN_DEFINITION)) });

    expect(missing).toEqual({ kind: 'unavailable', detail: expect.stringContaining("the usage report's paths are not relative to the repository root") });
    expect(missing.kind === 'unavailable' && missing.detail).toContain(STEP_FILE);
    expect(unknown).toEqual({ kind: 'usage', framework: 'cucumber-js', usages: [{ file: 'unknown', line: 0, pattern: 'a generated step', usedBy: [] }] });
  });

  it('removes its temporary report directory on every path', async () => {
    const commands = { installDeps: 'N/A', runScenariosByTag: '' };
    const paths = [
      writeReport(ONE_DEFINITION),
      `exit 2 # ${REPORT_PATH_PLACEHOLDER}`,
      writeReport('not json'),
      writeReport(JSON.stringify([{ matches: [], line: 1, pattern: 'p', patternType: 'CucumberExpression', uri: 'gone.ts' }])),
    ];

    for (const command of paths) {
      const { calls, run } = recordingRunner();
      await runStepUsageReport({ worktreePath: worktree, commands, reader: readerRunning(command), runProcess: run });
      expect(fs.existsSync(reportDirectoryOf(calls[0].command)), command).toBe(false);
    }

    const seen: string[] = [];
    const throwing: ProcessRunner = (command) => {
      seen.push(command);
      throw new Error('spawn failed');
    };
    const outcome = await runStepUsageReport({ worktreePath: worktree, commands, reader: readerRunning(writeReport('[]')), runProcess: throwing });
    expect(outcome.kind).toBe('unavailable');
    expect(fs.existsSync(reportDirectoryOf(seen[0]))).toBe(false);
  });
});

function reconcileDeps() {
  return {
    log: vi.fn(),
    fileRemovalIssue: vi.fn((_spec: UnusedStepIssueSpec): number => 77),
    listOpenRemovalIssues: vi.fn((): UnusedStepIssueRef[] => []),
    framework: 'cucumber-js',
    defaultBranch: 'main' as string | null,
  } satisfies ReconcileUnusedStepIssueDeps;
}

describe('reconcileUnusedStepIssue', () => {
  it('reconcileUnusedStepIssue files one issue with its labels when none is open', () => {
    const deps = reconcileDeps();

    reconcileUnusedStepIssue(UNUSED, deps);

    expect(deps.fileRemovalIssue).toHaveBeenCalledTimes(1);
    const spec = deps.fileRemovalIssue.mock.calls[0][0];
    expect(spec.labels).toEqual(['adw:chore']);
    expect(spec.body.startsWith(`${UNUSED_STEP_ISSUE_MARKER}\n`)).toBe(true);
    expect(spec.body).toContain(`\`${STEP_FILE}:3\` — \`an order is placed\``);
    expect(spec.body).toContain('cucumber-js dry run on `main`');
    expect(deps.log).toHaveBeenCalledWith('perIssueScenarioSweep: filed removal issue #77 listing 2 unused step definition(s)', 'success');
  });

  it('reconcileUnusedStepIssue files none while an open issue carries the marker', () => {
    const deps = reconcileDeps();
    deps.listOpenRemovalIssues.mockReturnValue([{ number: 12, body: `${UNUSED_STEP_ISSUE_MARKER}\n\nolder list`, state: 'OPEN' }]);

    reconcileUnusedStepIssue(UNUSED, deps);

    expect(deps.fileRemovalIssue).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('2 unused step definition(s); removal issue #12 is still open — not filing another'), 'info');
  });

  it('reconcileUnusedStepIssue files none and logs a warning when listing open issues fails', () => {
    const deps = reconcileDeps();
    deps.listOpenRemovalIssues.mockImplementation(() => {
      throw new Error('gh: rate limited');
    });

    reconcileUnusedStepIssue(UNUSED, deps);

    expect(deps.fileRemovalIssue).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('gh: rate limited'), 'warn');
  });

  it('reconcileUnusedStepIssue files none when nothing is unused', () => {
    const deps = reconcileDeps();

    reconcileUnusedStepIssue([], deps);

    expect(deps.listOpenRemovalIssues).not.toHaveBeenCalled();
    expect(deps.fileRemovalIssue).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith('perIssueScenarioSweep: no unused step definitions', 'info');
  });

  it('reconcileUnusedStepIssue logs and swallows a filing failure', () => {
    const deps = reconcileDeps();
    deps.fileRemovalIssue.mockImplementation(() => {
      throw new Error('label not found');
    });

    expect(() => reconcileUnusedStepIssue(UNUSED, deps)).not.toThrow();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('label not found'), 'error');
  });
});

describe('the default collaborators', () => {
  it('the default issue listing searches open issues for the marker phrase, and the default filing creates the issue and applies each label', () => {
    const tracker = {
      listIssues: vi.fn(() => [{ number: 5, body: 'body five', state: 'OPEN' }, { number: 6 }]),
      createIssue: vi.fn(() => 91),
      applyLabel: vi.fn(),
    };
    const spec: UnusedStepIssueSpec = { title: 'chore: remove 1 unused step definition(s)', body: UNUSED_STEP_ISSUE_MARKER, labels: ['adw:chore'] };

    expect(defaultListOpenRemovalIssues(tracker)()).toEqual([{ number: 5, body: 'body five', state: 'OPEN' }, { number: 6, body: '', state: undefined }]);
    expect(tracker.listIssues).toHaveBeenCalledWith({ fields: ['number', 'body', 'state'], state: 'open', search: '"unused-step-definitions"', limit: 100 });
    expect(defaultFileRemovalIssue(tracker)(spec)).toBe(91);
    expect(tracker.createIssue).toHaveBeenCalledWith(spec.title, spec.body);
    expect(tracker.applyLabel).toHaveBeenCalledWith(91, 'adw:chore');

    tracker.listIssues.mockImplementation(() => {
      throw new Error('gh failed');
    });
    expect(() => defaultListOpenRemovalIssues(tracker)()).toThrow('gh failed');
  });

  it("the default step usage reports not supported for the target's BDD framework read from the sweep worktree, and unavailable when no sweep worktree exists", async () => {
    fs.mkdirSync(path.join(worktree, '.adw'));
    fs.writeFileSync(path.join(worktree, '.adw/scenarios.md'), '# Scenarios\n\n## BDD Framework\nbehave\n');

    expect(await defaultReadStepUsage(() => ({ worktreePath: worktree }), vi.fn())()).toEqual({ kind: 'not_supported', framework: 'behave' });
    expect(await defaultReadStepUsage(() => null, vi.fn())()).toEqual({ kind: 'unavailable', detail: expect.stringContaining('no sweep worktree') });
  });
});
