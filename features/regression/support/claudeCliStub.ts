import { resolve } from 'path';
import { REPO_ROOT, clearClaudeCodePathCache } from '../../../adws/core/environment.ts';
import type { RegressionWorld } from '../step_definitions/world.ts';

export const CLAUDE_CLI_STUB = resolve(REPO_ROOT, 'test/mocks/claude-cli-stub.ts');

/** The cache is cleared on both sides, so no agent started later resolves the stub, or the path it replaced, from a stale entry. */
export function pointClaudeCodeAtStub(world: Pick<RegressionWorld, 'cleanup'>): void {
  const saved = process.env['CLAUDE_CODE_PATH'];
  process.env['CLAUDE_CODE_PATH'] = CLAUDE_CLI_STUB;
  clearClaudeCodePathCache();
  world.cleanup.push(() => {
    if (saved === undefined) delete process.env['CLAUDE_CODE_PATH'];
    else process.env['CLAUDE_CODE_PATH'] = saved;
    clearClaudeCodePathCache();
  });
}
