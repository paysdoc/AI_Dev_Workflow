import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StaticCheckName } from '../../core/checkRunner';
import { MAX_FIX_PROMPT_OUTPUT_CHARS, toStaticCheckFailure } from '../staticCheckFixRound';
import { BUILD, LINT, failing, removeTempDirs } from './staticCheckFixRound.helpers';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  removeTempDirs();
});

describe('toStaticCheckFailure — the one input of a round’s agent run', () => {
  it('names the round in the test name, and is a failed test', () => {
    const failure = toStaticCheckFailure([LINT], 3);

    expect(failure.test_name).toBe('static-checks-round-3');
    expect(failure.passed).toBe(false);
  });

  it('lists the command of each failing check, one per line', () => {
    expect(toStaticCheckFailure([LINT, BUILD], 1).execution_command).toBe('bun run lint\nbun run build');
  });

  it('names the failing checks in the purpose, and says that each passes on exit 0', () => {
    const purpose = toStaticCheckFailure([LINT, BUILD], 1).test_purpose;

    expect(purpose).toContain('lint');
    expect(purpose).toContain('build');
    expect(purpose).toMatch(/exits? (with code )?0/);
  });

  it('holds one section per failing check, in check order, with its name, command, exit code and output', () => {
    const error = toStaticCheckFailure([LINT, BUILD], 1).error ?? '';

    expect(error.indexOf('lint')).toBeGreaterThan(-1);
    expect(error.indexOf('build')).toBeGreaterThan(error.indexOf('lint'));
    expect(error).toContain('Command: bun run lint');
    expect(error).toContain('Exit code: 1');
    expect(error).toContain('src/app.ts: 2 problems');
    expect(error).toContain('Command: bun run build');
    expect(error).toContain('Exit code: 2');
    expect(error).toContain("error: Could not resolve './missing'");
  });

  it('says "none" for a check that has no exit code', () => {
    const error = toStaticCheckFailure([failing(StaticCheckName.TypeCheck, 'bunx tsc --noEmit', 'Terminated', null)], 1).error ?? '';

    expect(error).toContain('Exit code: none');
  });

  it('says that a check printed nothing when it printed nothing', () => {
    const error = toStaticCheckFailure([failing(StaticCheckName.Lint, 'bun run lint', '')], 1).error ?? '';

    expect(error).toContain('(no output)');
  });

  it('cuts an output longer than the cap, and tells the agent to run the command for the rest', () => {
    const output = `${'x'.repeat(MAX_FIX_PROMPT_OUTPUT_CHARS)}TAIL-THAT-IS-CUT`;
    const error = toStaticCheckFailure([failing(StaticCheckName.Lint, 'bun run lint', output)], 1).error ?? '';

    expect(error).toContain('x'.repeat(MAX_FIX_PROMPT_OUTPUT_CHARS));
    expect(error).not.toContain('TAIL-THAT-IS-CUT');
    expect(error).toContain(`output cut after ${MAX_FIX_PROMPT_OUTPUT_CHARS} characters; run the command to see the rest`);
  });

  it('passes an output that fits unchanged', () => {
    const output = 'y'.repeat(MAX_FIX_PROMPT_OUTPUT_CHARS);
    const error = toStaticCheckFailure([failing(StaticCheckName.Lint, 'bun run lint', output)], 1).error ?? '';

    expect(error).toContain(output);
    expect(error).not.toContain('output cut after');
  });
});
