import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { revertIssueCostFile } from '../costCsvWriter';

vi.mock('../utils', () => ({
  log: vi.fn(),
  slugify: (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReaddirSync = vi.mocked(fs.readdirSync);
const mockUnlinkSync = vi.mocked(fs.unlinkSync);

describe('revertIssueCostFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes a matching issue CSV file and returns its path', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['42-add-login.csv'] as unknown as ReturnType<typeof fs.readdirSync>);

    const result = revertIssueCostFile('/repo', 'my-repo', 42);

    expect(result).toEqual(['projects/my-repo/42-add-login.csv']);
    expect(mockUnlinkSync).toHaveBeenCalledWith('/repo/projects/my-repo/42-add-login.csv');
  });

  it('returns empty array when no matching file exists', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['99-other-issue.csv', 'total-cost.csv'] as unknown as ReturnType<typeof fs.readdirSync>);

    const result = revertIssueCostFile('/repo', 'my-repo', 42);

    expect(result).toEqual([]);
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });

  it('returns empty array when the project directory does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = revertIssueCostFile('/repo', 'my-repo', 42);

    expect(result).toEqual([]);
    expect(mockReaddirSync).not.toHaveBeenCalled();
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });

  it('deletes all matching files when multiple matches exist', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([
      '42-add-login.csv',
      '42-add-login-v2.csv',
    ] as unknown as ReturnType<typeof fs.readdirSync>);

    const result = revertIssueCostFile('/repo', 'my-repo', 42);

    expect(result).toEqual(['projects/my-repo/42-add-login.csv', 'projects/my-repo/42-add-login-v2.csv']);
    expect(mockUnlinkSync).toHaveBeenCalledTimes(2);
    expect(mockUnlinkSync).toHaveBeenCalledWith('/repo/projects/my-repo/42-add-login.csv');
    expect(mockUnlinkSync).toHaveBeenCalledWith('/repo/projects/my-repo/42-add-login-v2.csv');
  });

  it('does not delete total-cost.csv even if issue number matches pattern', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['total-cost.csv'] as unknown as ReturnType<typeof fs.readdirSync>);

    const result = revertIssueCostFile('/repo', 'my-repo', 42);

    expect(result).toEqual([]);
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });
});
