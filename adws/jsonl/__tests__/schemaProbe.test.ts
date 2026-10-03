import { describe, it, expect, afterEach } from 'vitest';
import { checkClaudeJsonlSchema } from '../schemaProbe';
import { clearClaudeCodePathCache } from '../../core/environment';
import { createRecordingClaudeCli, overrideEnv, type RecordingClaudeCli } from '../../core/__tests__/fixtures/recordingClaudeCli';

describe('checkClaudeJsonlSchema launch environment', () => {
  let cli: RecordingClaudeCli | undefined;
  let restoreEnv: (() => void) | undefined;

  afterEach(() => {
    restoreEnv?.();
    clearClaudeCodePathCache();
    cli?.cleanup();
    cli = undefined;
  });

  it('starts the claude process with auto-memory disabled and without unlisted variables', async () => {
    cli = createRecordingClaudeCli();
    restoreEnv = overrideEnv({
      CLAUDE_CODE_PATH: cli.cliPath,
      ADW_RECORDING_SENTINEL: 'leak',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
    });
    clearClaudeCodePathCache();

    await expect(checkClaudeJsonlSchema()).rejects.toThrow(/produced no output/);

    expect(cli.readInvocations()).toEqual([{ memory: '1', hooksLogDir: '', sentinel: '' }]);
  });
});
