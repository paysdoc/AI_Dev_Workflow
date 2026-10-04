import { describe, it, expect } from 'vitest';
import {
  runStaticChecks,
  CheckStatus,
  StaticCheckName,
  type ProcessOutcome,
  type ProcessRunner,
  type StaticCheckCommands,
} from '../checkRunner';

const CWD = '/work/tree';

const COMMANDS: StaticCheckCommands = {
  typeCheck: 'tc',
  additionalTypeChecks: 'atc',
  runLinter: 'lint',
  runBuild: 'build',
};

const ALL_NOT_APPLICABLE: StaticCheckCommands = {
  typeCheck: 'N/A',
  additionalTypeChecks: 'N/A',
  runLinter: 'N/A',
  runBuild: 'N/A',
};

const CHECK_ORDER = [
  StaticCheckName.TypeCheck,
  StaticCheckName.AdditionalTypeChecks,
  StaticCheckName.Lint,
  StaticCheckName.Build,
];

type Script = Readonly<Record<string, ProcessOutcome | Error>>;

function fakeProcessRunner(script: Script = {}): { runProcess: ProcessRunner; calls: { command: string; cwd: string }[] } {
  const calls: { command: string; cwd: string }[] = [];
  const runProcess: ProcessRunner = async (command, cwd) => {
    calls.push({ command, cwd });
    const scripted = script[command] ?? { exitCode: 0, output: '' };
    if (scripted instanceof Error) throw scripted;
    return scripted;
  };
  return { runProcess, calls };
}

describe('runStaticChecks — order', () => {
  it('runs type check, additional type checks, lint and build in that order, each in the given directory', async () => {
    const { runProcess, calls } = fakeProcessRunner();

    await runStaticChecks(COMMANDS, CWD, runProcess);

    expect(calls).toEqual([
      { command: 'tc', cwd: CWD },
      { command: 'atc', cwd: CWD },
      { command: 'lint', cwd: CWD },
      { command: 'build', cwd: CWD },
    ]);
  });

  it('returns exactly one verdict per check, in the fixed order', async () => {
    const { runProcess } = fakeProcessRunner();

    const verdicts = await runStaticChecks(COMMANDS, CWD, runProcess);

    expect(verdicts.map(verdict => verdict.check)).toEqual(CHECK_ORDER);
  });

  it('runs the checks one at a time, each finishing before the next starts', async () => {
    const events: string[] = [];
    const runProcess: ProcessRunner = async (command) => {
      events.push(`start ${command}`);
      await new Promise(resolve => setTimeout(resolve, 5));
      events.push(`end ${command}`);
      return { exitCode: 0, output: '' };
    };

    await runStaticChecks(COMMANDS, CWD, runProcess);

    expect(events).toEqual([
      'start tc', 'end tc',
      'start atc', 'end atc',
      'start lint', 'end lint',
      'start build', 'end build',
    ]);
  });
});

describe('runStaticChecks — verdict per exit code', () => {
  it('passes a check that exits 0', async () => {
    const { runProcess } = fakeProcessRunner();

    const [typeCheck] = await runStaticChecks(COMMANDS, CWD, runProcess);

    expect(typeCheck).toMatchObject({ status: CheckStatus.Passed, exitCode: 0 });
  });

  it.each([1, 2, 127])('fails a check that exits %i and carries the exit code through', async (exitCode) => {
    const { runProcess } = fakeProcessRunner({ lint: { exitCode, output: '' } });

    const verdicts = await runStaticChecks(COMMANDS, CWD, runProcess);

    expect(verdicts[2]).toMatchObject({ check: StaticCheckName.Lint, status: CheckStatus.Failed, exitCode });
  });

  it('fails a check that has no exit code, such as one killed by a signal', async () => {
    const { runProcess } = fakeProcessRunner({ build: { exitCode: null, output: 'Terminated' } });

    const verdicts = await runStaticChecks(COMMANDS, CWD, runProcess);

    expect(verdicts[3]).toMatchObject({ check: StaticCheckName.Build, status: CheckStatus.Failed, exitCode: null });
  });

  it('decides the verdict by the exit code alone, whatever the output says', async () => {
    const { runProcess } = fakeProcessRunner({
      tc: { exitCode: 0, output: 'error TS2322: Type string is not assignable to type number' },
      lint: { exitCode: 1, output: 'All files pass linting.' },
    });

    const verdicts = await runStaticChecks(COMMANDS, CWD, runProcess);

    expect(verdicts[0]).toMatchObject({ status: CheckStatus.Passed });
    expect(verdicts[2]).toMatchObject({ status: CheckStatus.Failed });
  });

  it('does not stop at a failing check: the checks after it still run and are reported', async () => {
    const { runProcess, calls } = fakeProcessRunner({ lint: { exitCode: 1, output: 'lint broke' } });

    const verdicts = await runStaticChecks(COMMANDS, CWD, runProcess);

    expect(calls.map(call => call.command)).toEqual(['tc', 'atc', 'lint', 'build']);
    expect(verdicts.map(verdict => verdict.status)).toEqual([
      CheckStatus.Passed,
      CheckStatus.Passed,
      CheckStatus.Failed,
      CheckStatus.Passed,
    ]);
  });
});

describe('runStaticChecks — N/A', () => {
  it('reports an N/A check as skipped, without an exit code or output, and never runs it', async () => {
    const { runProcess, calls } = fakeProcessRunner();

    const verdicts = await runStaticChecks({ ...COMMANDS, additionalTypeChecks: 'N/A' }, CWD, runProcess);

    expect(verdicts[1]).toEqual({
      check: StaticCheckName.AdditionalTypeChecks,
      command: 'N/A',
      status: CheckStatus.Skipped,
      exitCode: null,
      output: '',
    });
    expect(calls.map(call => call.command)).toEqual(['tc', 'lint', 'build']);
  });

  it.each(['n/a', '  n/a  ', 'N/a\n'])('treats %j as N/A: skipped and not run', async (command) => {
    const { runProcess, calls } = fakeProcessRunner();

    const verdicts = await runStaticChecks({ ...COMMANDS, runLinter: command }, CWD, runProcess);

    expect(verdicts[2]).toMatchObject({ check: StaticCheckName.Lint, status: CheckStatus.Skipped, exitCode: null, output: '' });
    expect(calls.map(call => call.command)).not.toContain(command);
  });

  it.each(['', '   ', '\n'])('treats the blank command %j as skipped, so a blank command can never pass silently', async (command) => {
    const { runProcess, calls } = fakeProcessRunner();

    const verdicts = await runStaticChecks({ ...COMMANDS, runBuild: command }, CWD, runProcess);

    expect(verdicts[3]).toMatchObject({ check: StaticCheckName.Build, status: CheckStatus.Skipped, exitCode: null });
    expect(calls.map(call => call.command)).toEqual(['tc', 'atc', 'lint']);
  });

  it('reports four skipped verdicts in the fixed order, and runs nothing, when every check is N/A', async () => {
    const { runProcess, calls } = fakeProcessRunner();

    const verdicts = await runStaticChecks(ALL_NOT_APPLICABLE, CWD, runProcess);

    expect(verdicts.map(verdict => [verdict.check, verdict.status])).toEqual(
      CHECK_ORDER.map(check => [check, CheckStatus.Skipped]),
    );
    expect(calls).toEqual([]);
  });
});

describe('runStaticChecks — captured output', () => {
  it("gives each verdict the output of its own command, unchanged", async () => {
    const { runProcess } = fakeProcessRunner({
      tc: { exitCode: 0, output: 'src: 0 errors\n' },
      atc: { exitCode: 0, output: 'adws: 0 errors\n' },
      lint: { exitCode: 1, output: 'src/a.ts:1:1 unexpected\nsrc/b.ts:2:2 unused\n' },
      build: { exitCode: 2, output: 'error: could not resolve ./missing\n' },
    });

    const verdicts = await runStaticChecks(COMMANDS, CWD, runProcess);

    expect(verdicts.map(verdict => verdict.output)).toEqual([
      'src: 0 errors\n',
      'adws: 0 errors\n',
      'src/a.ts:1:1 unexpected\nsrc/b.ts:2:2 unused\n',
      'error: could not resolve ./missing\n',
    ]);
  });

  it('reports the command each verdict ran', async () => {
    const { runProcess } = fakeProcessRunner();

    const verdicts = await runStaticChecks(COMMANDS, CWD, runProcess);

    expect(verdicts.map(verdict => verdict.command)).toEqual(['tc', 'atc', 'lint', 'build']);
  });
});

describe('runStaticChecks — a process runner that throws', () => {
  it('fails that check with no exit code and the error text as its output, and still runs the rest', async () => {
    const { runProcess, calls } = fakeProcessRunner({ atc: new Error('spawn /bin/sh ENOENT') });

    const verdicts = await runStaticChecks(COMMANDS, CWD, runProcess);

    expect(verdicts[1]).toMatchObject({ check: StaticCheckName.AdditionalTypeChecks, status: CheckStatus.Failed, exitCode: null });
    expect(verdicts[1].output).toContain('spawn /bin/sh ENOENT');
    expect(calls.map(call => call.command)).toEqual(['tc', 'atc', 'lint', 'build']);
    expect(verdicts.map(verdict => verdict.status)).toEqual([
      CheckStatus.Passed,
      CheckStatus.Failed,
      CheckStatus.Passed,
      CheckStatus.Passed,
    ]);
  });
});
