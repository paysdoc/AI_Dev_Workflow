import { describe, it, expect, afterEach } from 'vitest';
import { runGuardrailsProbe } from '../guardrailsProbe';
import { clearClaudeCodePathCache } from '../environment';
import { createRecordingClaudeCli, overrideEnv, type RecordingClaudeCli } from './fixtures/recordingClaudeCli';

describe('runGuardrailsProbe launch environment', () => {
  let cli: RecordingClaudeCli | undefined;
  let restoreEnv: (() => void) | undefined;

  afterEach(() => {
    restoreEnv?.();
    clearClaudeCodePathCache();
    cli?.cleanup();
    cli = undefined;
  });

  it('starts every claude process of the deny matrix with auto-memory disabled and a hook log directory', async () => {
    cli = createRecordingClaudeCli();
    restoreEnv = overrideEnv({
      CLAUDE_CODE_PATH: cli.cliPath,
      ADW_RECORDING_SENTINEL: 'leak',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
    });
    clearClaudeCodePathCache();

    const verdict = await runGuardrailsProbe();

    expect(verdict.ok).toBe(false);
    const invocations = cli.readInvocations();
    expect(invocations).toHaveLength(4);
    for (const invocation of invocations) {
      expect(invocation.memory).toBe('1');
      expect(invocation.hooksLogDir).not.toBe('');
      expect(invocation.sentinel).toBe('');
    }
  }, 60_000);
});
