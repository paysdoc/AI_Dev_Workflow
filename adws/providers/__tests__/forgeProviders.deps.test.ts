/**
 * forgeProviders.deps.test.ts — deps.github seams (onStatusMoved,
 * resolveLabelDefinition, canApprovePullRequests) and deps.logger threading.
 * Split out of forgeProviders.test.ts; see that file's header for the
 * sibling-suite layout.
 */

import { describe, it, expect, vi } from 'vitest';
import { forgeProviders } from '../forgeProviders';
import { BoardStatus } from '../types';
import type { ExecFn } from '../../gitContext';
import { makeCtx, makeSpyExec, baseOptions } from './forgeProvidersFixture';

const PROJECT_RESPONSE = JSON.stringify({ data: { repository: { projectsV2: { nodes: [{ id: 'PVT_1' }] } } } });
const ITEM_RESPONSE = JSON.stringify({
  data: { repository: { issue: { projectItems: { nodes: [
    { id: 'ITEM_1', project: { id: 'PVT_1' }, fieldValueByName: { name: 'Todo' } },
  ] } } } },
});
const MOVE_RESPONSE = JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'ITEM_1' } } } });

function fieldResponseFor(status: string): string {
  return JSON.stringify({ data: { node: { field: { id: 'FIELD_1', options: [{ id: 'OPT_1', name: status }] } } } });
}

function makeMoveExec(targetStatus: string): ExecFn {
  const responses = new Map([
    ['projectsV2(first:1)', PROJECT_RESPONSE],
    ['projectItems(first:50)', ITEM_RESPONSE],
    ['field(name:', fieldResponseFor(targetStatus)],
    ['updateProjectV2ItemFieldValue', MOVE_RESPONSE],
  ]);
  return makeSpyExec(responses).exec;
}

describe('forgeProviders — deps.github seams', () => {
  it('deps.github.onStatusMoved fires once, awaited, after a successful move to Review', async () => {
    const onStatusMoved = vi.fn().mockResolvedValue(undefined);
    const providers = forgeProviders(baseOptions({
      gitContext: makeCtx({}, makeMoveExec('Review')),
      deps: { github: { onStatusMoved } },
    }));

    const result = await providers.issueTracker.moveToStatus(42, BoardStatus.Review);

    expect(result).toBe(true);
    expect(onStatusMoved).toHaveBeenCalledTimes(1);
    expect(onStatusMoved).toHaveBeenCalledWith(42, BoardStatus.Review);
  });

  it('deps.github.onStatusMoved does not fire after a failed move', async () => {
    const onStatusMoved = vi.fn();
    const throwingExec: ExecFn = () => { throw new Error('gh api error: 500'); };
    const providers = forgeProviders(baseOptions({
      gitContext: makeCtx({}, throwingExec),
      deps: { github: { onStatusMoved } },
    }));

    const result = await providers.issueTracker.moveToStatus(42, BoardStatus.Review);

    expect(result).toBe(false);
    expect(onStatusMoved).not.toHaveBeenCalled();
  });

  it("deps.github.resolveLabelDefinition is consulted on applyLabel's lazy-create path", () => {
    const resolveLabelDefinition = vi.fn().mockReturnValue({ name: 'adw:blocked', color: 'b60205', description: 'x' });
    let editCalls = 0;
    const exec: ExecFn = (command) => {
      if (command.includes('issue edit')) {
        editCalls += 1;
        if (editCalls === 1) throw new Error('label not found');
      }
      return '';
    };
    const providers = forgeProviders(baseOptions({
      gitContext: makeCtx({}, exec),
      deps: { github: { resolveLabelDefinition } },
    }));

    providers.issueTracker.applyLabel(42, 'adw:blocked');

    expect(resolveLabelDefinition).toHaveBeenCalledWith('adw:blocked');
    expect(editCalls).toBe(2);
  });

  it('deps.github.canApprovePullRequests answers codeHost.canApprovePullRequests()', () => {
    const providers = forgeProviders(baseOptions({ deps: { github: { canApprovePullRequests: () => true } } }));
    expect(providers.codeHost.canApprovePullRequests()).toBe(true);

    const negativeProviders = forgeProviders(baseOptions({ deps: { github: { canApprovePullRequests: () => false } } }));
    expect(negativeProviders.codeHost.canApprovePullRequests()).toBe(false);
  });
});

describe('forgeProviders — deps.logger threading', () => {
  it("a capturing deps.logger receives the board manager's warn line on a failed project lookup", async () => {
    const logs: { message: string; level?: string }[] = [];
    const logger = (message: string, level?: string) => { logs.push({ message, level }); };
    const failingExec: ExecFn = () => { throw new Error('gh api error: 500'); };
    const providers = forgeProviders(baseOptions({
      gitContext: makeCtx({}, failingExec),
      deps: { logger },
    }));

    await providers.boardManager?.findBoard();

    expect(logs.some((l) => l.level === 'warn' && l.message.includes('acme/webapp'))).toBe(true);
  });
});
