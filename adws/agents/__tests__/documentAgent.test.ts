import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../commandAgent', () => ({
  runCommandAgent: vi.fn(),
}));

import { runCommandAgent } from '../commandAgent';
import { runDocumentAgent } from '../documentAgent';

const mockRunCommandAgent = vi.mocked(runCommandAgent);

beforeEach(() => {
  mockRunCommandAgent.mockReset();
  mockRunCommandAgent.mockResolvedValue({ success: true, output: 'app_docs/feature-x.md', parsed: 'app_docs/feature-x.md' } as never);
});

function argsOfCall(): readonly string[] {
  return (mockRunCommandAgent.mock.calls[0][1] as { args: readonly string[] }).args;
}

describe('runDocumentAgent — the arguments of /document', () => {
  it('passes the default branch as the fourth argument, after the spec and the screenshots directory', async () => {
    await runDocumentAgent('adw-1', '/logs', 'specs/plan.md', '/shots', undefined, undefined, undefined, undefined, undefined, 'trunk');

    expect(argsOfCall()).toEqual(['adw-1', 'specs/plan.md', '/shots', 'trunk']);
  });

  it('passes an empty fourth argument when no default branch is given, so the prompt resolves it itself', async () => {
    await runDocumentAgent('adw-1', '/logs');

    expect(argsOfCall()).toEqual(['adw-1', '', '', '']);
  });

  it('returns the documentation path the agent produced', async () => {
    const result = await runDocumentAgent('adw-1', '/logs', undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'trunk');

    expect(result.docPath).toBe('app_docs/feature-x.md');
  });
});
