import { describe, it, expect, afterEach } from 'vitest';
import { loadProjectConfig, getDefaultProjectConfig } from '../projectConfig';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

const NO_DEVICE_SOURCE = {
  androidSystemImage: null,
  androidDeviceProfile: null,
  iosDeviceType: null,
  iosRuntime: null,
};

describe('getDefaultProjectConfig — no device source', () => {
  it('has none, so that a repository without ADW configuration is never taken to have devices', () => {
    expect(getDefaultProjectConfig().deviceSources).toEqual(NO_DEVICE_SOURCE);
  });
});

describe('loadProjectConfig — device-source sections', () => {
  const dirs: string[] = [];

  function repoWithProjectMd(projectMd: string | null): string {
    const dir = mkdtempSync(join(tmpdir(), 'adw-test-devsrc-'));
    dirs.push(dir);
    mkdirSync(join(dir, '.adw'));
    if (projectMd !== null) writeFileSync(join(dir, '.adw', 'project.md'), projectMd, 'utf-8');
    return dir;
  }

  afterEach(() => {
    dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }));
  });

  it('exposes the four values as written, with no comment left in them', () => {
    const projectMd = [
      '## Application Type',
      'mobile:kotlincm',
      '',
      '## Android System Image',
      'system-images;android-35;google_apis;arm64-v8a',
      '',
      '## Android Device Profile',
      'pixel_8',
      '<!-- default written by adw_init -->',
      '',
      '## iOS Device Type',
      'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
      '',
      '## iOS Runtime',
      'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
    ].join('\n');

    expect(loadProjectConfig(repoWithProjectMd(projectMd)).deviceSources).toEqual({
      androidSystemImage: 'system-images;android-35;google_apis;arm64-v8a',
      androidDeviceProfile: 'pixel_8',
      iosDeviceType: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
      iosRuntime: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
    });
  });

  it('exposes none from a project.md without the sections', () => {
    expect(loadProjectConfig(repoWithProjectMd('## Application Type\nmobile:kotlincm\n')).deviceSources).toEqual(NO_DEVICE_SOURCE);
  });

  it('exposes none from an .adw/ directory that holds no project.md', () => {
    expect(loadProjectConfig(repoWithProjectMd(null)).deviceSources).toEqual(NO_DEVICE_SOURCE);
  });

  it("exposes none from this repository's own .adw/project.md, a cli repository that names no device source", () => {
    expect(loadProjectConfig(resolve(__dirname, '..', '..', '..')).deviceSources).toEqual(NO_DEVICE_SOURCE);
  });
});
