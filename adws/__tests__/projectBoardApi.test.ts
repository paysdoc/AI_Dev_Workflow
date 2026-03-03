import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../core/utils', () => ({
  log: vi.fn(),
}));

vi.mock('../core/targetRepoRegistry', () => ({
  getTargetRepo: vi.fn(() => ({ owner: 'test-owner', repo: 'test-repo' })),
}));

import { execSync } from 'child_process';
import { log } from '../core/utils';
import {
  findRepoProjectId,
  findIssueProjectItem,
  getStatusFieldOptions,
  moveIssueToStatus,
} from '../github/projectBoardApi';

const mockedExecSync = vi.mocked(execSync);

describe('findRepoProjectId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns project ID when project exists', () => {
    mockedExecSync.mockReturnValue(
      JSON.stringify({
        data: {
          repository: {
            projectsV2: { nodes: [{ id: 'PVT_123' }] },
          },
        },
      })
    );

    const result = findRepoProjectId('owner', 'repo');

    expect(result).toBe('PVT_123');
  });

  it('returns null when no projects exist', () => {
    mockedExecSync.mockReturnValue(
      JSON.stringify({
        data: {
          repository: {
            projectsV2: { nodes: [] },
          },
        },
      })
    );

    const result = findRepoProjectId('owner', 'repo');

    expect(result).toBeNull();
  });

  it('returns null and logs when gh command fails', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('gh command failed');
    });

    const result = findRepoProjectId('owner', 'repo');

    expect(result).toBeNull();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Failed to find project'),
      'warn'
    );
  });
});

describe('findIssueProjectItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns item ID and current status', () => {
    mockedExecSync.mockReturnValue(
      JSON.stringify({
        data: {
          repository: {
            issue: {
              projectItems: {
                nodes: [
                  {
                    id: 'PVTI_456',
                    project: { id: 'PVT_123' },
                    fieldValueByName: { name: 'Todo' },
                  },
                ],
              },
            },
          },
        },
      })
    );

    const result = findIssueProjectItem('owner', 'repo', 42, 'PVT_123');

    expect(result).toEqual({
      itemId: 'PVTI_456',
      currentStatus: 'Todo',
    });
  });

  it('returns null when issue is not in the project', () => {
    mockedExecSync.mockReturnValue(
      JSON.stringify({
        data: {
          repository: {
            issue: {
              projectItems: {
                nodes: [
                  {
                    id: 'PVTI_789',
                    project: { id: 'PVT_OTHER' },
                    fieldValueByName: { name: 'Todo' },
                  },
                ],
              },
            },
          },
        },
      })
    );

    const result = findIssueProjectItem('owner', 'repo', 42, 'PVT_123');

    expect(result).toBeNull();
  });

  it('returns null and logs when gh command fails', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('network error');
    });

    const result = findIssueProjectItem('owner', 'repo', 42, 'PVT_123');

    expect(result).toBeNull();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Failed to find issue'),
      'warn'
    );
  });
});

describe('getStatusFieldOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns field ID and options', () => {
    mockedExecSync.mockReturnValue(
      JSON.stringify({
        data: {
          node: {
            field: {
              id: 'PVTSSF_001',
              options: [
                { id: 'opt_1', name: 'Todo' },
                { id: 'opt_2', name: 'In Progress' },
                { id: 'opt_3', name: 'Done' },
              ],
            },
          },
        },
      })
    );

    const result = getStatusFieldOptions('PVT_123');

    expect(result).toEqual({
      fieldId: 'PVTSSF_001',
      options: [
        { id: 'opt_1', name: 'Todo' },
        { id: 'opt_2', name: 'In Progress' },
        { id: 'opt_3', name: 'Done' },
      ],
    });
  });

  it('returns null when no Status field exists', () => {
    mockedExecSync.mockReturnValue(
      JSON.stringify({
        data: {
          node: {
            field: null,
          },
        },
      })
    );

    const result = getStatusFieldOptions('PVT_123');

    expect(result).toBeNull();
  });

  it('returns null and logs when gh command fails', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('auth error');
    });

    const result = getStatusFieldOptions('PVT_123');

    expect(result).toBeNull();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Failed to get status field options'),
      'warn'
    );
  });
});

describe('moveIssueToStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully updates status', async () => {
    // findRepoProjectId
    mockedExecSync.mockReturnValueOnce(
      JSON.stringify({
        data: { repository: { projectsV2: { nodes: [{ id: 'PVT_123' }] } } },
      })
    );
    // findIssueProjectItem
    mockedExecSync.mockReturnValueOnce(
      JSON.stringify({
        data: {
          repository: {
            issue: {
              projectItems: {
                nodes: [{
                  id: 'PVTI_456',
                  project: { id: 'PVT_123' },
                  fieldValueByName: { name: 'Todo' },
                }],
              },
            },
          },
        },
      })
    );
    // getStatusFieldOptions
    mockedExecSync.mockReturnValueOnce(
      JSON.stringify({
        data: {
          node: {
            field: {
              id: 'PVTSSF_001',
              options: [
                { id: 'opt_1', name: 'Todo' },
                { id: 'opt_2', name: 'In Progress' },
                { id: 'opt_3', name: 'Done' },
              ],
            },
          },
        },
      })
    );
    // updateProjectItemStatus
    mockedExecSync.mockReturnValueOnce('{}');

    await moveIssueToStatus(42, 'In Progress', { owner: 'owner', repo: 'repo' });

    expect(mockedExecSync).toHaveBeenCalledTimes(4);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Moved issue #42 to "In Progress"'),
      'success'
    );
  });

  it('skips when issue already in target status', async () => {
    mockedExecSync.mockReturnValueOnce(
      JSON.stringify({
        data: { repository: { projectsV2: { nodes: [{ id: 'PVT_123' }] } } },
      })
    );
    mockedExecSync.mockReturnValueOnce(
      JSON.stringify({
        data: {
          repository: {
            issue: {
              projectItems: {
                nodes: [{
                  id: 'PVTI_456',
                  project: { id: 'PVT_123' },
                  fieldValueByName: { name: 'In Progress' },
                }],
              },
            },
          },
        },
      })
    );

    await moveIssueToStatus(42, 'In Progress', { owner: 'owner', repo: 'repo' });

    // Should only call findRepoProjectId and findIssueProjectItem, not update
    expect(mockedExecSync).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('already in "In Progress"'),
      'info'
    );
  });

  it('skips when target status does not exist in project options', async () => {
    mockedExecSync.mockReturnValueOnce(
      JSON.stringify({
        data: { repository: { projectsV2: { nodes: [{ id: 'PVT_123' }] } } },
      })
    );
    mockedExecSync.mockReturnValueOnce(
      JSON.stringify({
        data: {
          repository: {
            issue: {
              projectItems: {
                nodes: [{
                  id: 'PVTI_456',
                  project: { id: 'PVT_123' },
                  fieldValueByName: { name: 'Todo' },
                }],
              },
            },
          },
        },
      })
    );
    mockedExecSync.mockReturnValueOnce(
      JSON.stringify({
        data: {
          node: {
            field: {
              id: 'PVTSSF_001',
              options: [
                { id: 'opt_1', name: 'Todo' },
                { id: 'opt_3', name: 'Done' },
              ],
            },
          },
        },
      })
    );

    await moveIssueToStatus(42, 'Nonexistent', { owner: 'owner', repo: 'repo' });

    expect(mockedExecSync).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"Nonexistent" not found in project options'),
      'info'
    );
  });

  it('skips when no project is linked to the repo', async () => {
    mockedExecSync.mockReturnValueOnce(
      JSON.stringify({
        data: { repository: { projectsV2: { nodes: [] } } },
      })
    );

    await moveIssueToStatus(42, 'In Progress', { owner: 'owner', repo: 'repo' });

    expect(mockedExecSync).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('No project linked'),
      'info'
    );
  });

  it('skips when issue is not in the project', async () => {
    mockedExecSync.mockReturnValueOnce(
      JSON.stringify({
        data: { repository: { projectsV2: { nodes: [{ id: 'PVT_123' }] } } },
      })
    );
    mockedExecSync.mockReturnValueOnce(
      JSON.stringify({
        data: {
          repository: {
            issue: {
              projectItems: { nodes: [] },
            },
          },
        },
      })
    );

    await moveIssueToStatus(42, 'In Progress', { owner: 'owner', repo: 'repo' });

    expect(mockedExecSync).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('not found in project'),
      'info'
    );
  });

  it('matches "Review" to "In Review" via fuzzy match', async () => {
    mockedExecSync.mockReturnValueOnce(
      JSON.stringify({
        data: { repository: { projectsV2: { nodes: [{ id: 'PVT_123' }] } } },
      })
    );
    mockedExecSync.mockReturnValueOnce(
      JSON.stringify({
        data: {
          repository: {
            issue: {
              projectItems: {
                nodes: [{
                  id: 'PVTI_456',
                  project: { id: 'PVT_123' },
                  fieldValueByName: { name: 'Todo' },
                }],
              },
            },
          },
        },
      })
    );
    mockedExecSync.mockReturnValueOnce(
      JSON.stringify({
        data: {
          node: {
            field: {
              id: 'PVTSSF_001',
              options: [
                { id: 'opt_1', name: 'Todo' },
                { id: 'opt_2', name: 'In Review' },
                { id: 'opt_3', name: 'Done' },
              ],
            },
          },
        },
      })
    );
    mockedExecSync.mockReturnValueOnce('{}');

    await moveIssueToStatus(42, 'Review', { owner: 'owner', repo: 'repo' });

    expect(mockedExecSync).toHaveBeenCalledTimes(4);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Moved issue #42 to "In Review"'),
      'success'
    );
  });

  it('does not throw on any error (catches and logs)', async () => {
    // Simulate: findRepoProjectId succeeds, findIssueProjectItem succeeds,
    // getStatusFieldOptions succeeds, but updateProjectItemStatus throws
    mockedExecSync.mockReturnValueOnce(
      JSON.stringify({
        data: { repository: { projectsV2: { nodes: [{ id: 'PVT_123' }] } } },
      })
    );
    mockedExecSync.mockReturnValueOnce(
      JSON.stringify({
        data: {
          repository: {
            issue: {
              projectItems: {
                nodes: [{
                  id: 'PVTI_456',
                  project: { id: 'PVT_123' },
                  fieldValueByName: { name: 'Todo' },
                }],
              },
            },
          },
        },
      })
    );
    mockedExecSync.mockReturnValueOnce(
      JSON.stringify({
        data: {
          node: {
            field: {
              id: 'PVTSSF_001',
              options: [
                { id: 'opt_1', name: 'Todo' },
                { id: 'opt_2', name: 'In Progress' },
              ],
            },
          },
        },
      })
    );
    mockedExecSync.mockImplementationOnce(() => {
      throw new Error('catastrophic failure');
    });

    await expect(
      moveIssueToStatus(42, 'In Progress', { owner: 'owner', repo: 'repo' })
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Failed to move issue'),
      'warn'
    );
  });

  it('uses getTargetRepo when repoInfo is not provided', async () => {
    mockedExecSync.mockReturnValueOnce(
      JSON.stringify({
        data: { repository: { projectsV2: { nodes: [] } } },
      })
    );

    await moveIssueToStatus(42, 'In Progress');

    expect(mockedExecSync).toHaveBeenCalledWith(
      expect.stringContaining('test-owner'),
      expect.any(Object)
    );
  });
});
