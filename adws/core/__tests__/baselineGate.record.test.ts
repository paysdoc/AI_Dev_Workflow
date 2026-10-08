import { describe, it, expect } from 'vitest';
import {
  BaselineStatus,
  declaredDevServerCommand,
  isBaselineWaived,
  type BaselineRecord,
} from '../baselineGate';
import { getDefaultCommandsConfig, parseCommandsMd } from '../projectConfig';

describe('declaredDevServerCommand', () => {
  it('returns the command of a configured section', () => {
    const md = '## Install Dependencies\nbun install\n\n## Start Dev Server\nbun run dev --port {PORT}\n\n## Health Check Path\n/\n';

    expect(declaredDevServerCommand(md)).toBe('bun run dev --port {PORT}');
  });

  it('returns null for N/A', () => {
    expect(declaredDevServerCommand('## Start Dev Server\nN/A\n')).toBeNull();
  });

  it('returns null for an empty section', () => {
    expect(declaredDevServerCommand('## Start Dev Server\n\n## Health Check Path\n/\n')).toBeNull();
  });

  it('returns null when there is no section, and never the default the parsed config fills in', () => {
    const md = '## Install Dependencies\nbun install\n';

    expect(parseCommandsMd(md).startDevServer).toBe(getDefaultCommandsConfig().startDevServer);
    expect(declaredDevServerCommand(md)).toBeNull();
    expect(declaredDevServerCommand('')).toBeNull();
  });
});

describe('isBaselineWaived', () => {
  const passed: BaselineRecord = { status: BaselineStatus.Passed, baseBranch: 'dev', baseCommit: 'abc1234', recordedAt: '2026-10-04T10:00:00.000Z' };
  const waived: BaselineRecord = { status: BaselineStatus.Waived, waivedPark: 'baseline_red', recordedAt: '2026-10-04T10:00:00.000Z' };

  it('is true for a waiver', () => {
    expect(isBaselineWaived(waived)).toBe(true);
  });

  it('is false for a passed baseline and for no record', () => {
    expect(isBaselineWaived(passed)).toBe(false);
    expect(isBaselineWaived(undefined)).toBe(false);
  });
});
