import { describe, it, expect } from 'vitest';
import { parseCommandsMd, getDefaultCommandsConfig, loadProjectConfig } from '../projectConfig';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('parseCommandsMd — healthCheckPath field', () => {
  it('defaults healthCheckPath to "/" when content is empty', () => {
    const result = parseCommandsMd('');
    expect(result.healthCheckPath).toBe('/');
  });

  it('defaults healthCheckPath to "/" when "## Health Check Path" section is absent', () => {
    const content = '## Start Dev Server\nbun run dev\n';
    const result = parseCommandsMd(content);
    expect(result.healthCheckPath).toBe('/');
  });

  it('reads healthCheckPath from "## Health Check Path" section', () => {
    const content = '## Health Check Path\n/api/health\n';
    const result = parseCommandsMd(content);
    expect(result.healthCheckPath).toBe('/api/health');
  });

  it('reads a custom healthCheckPath while preserving other defaults', () => {
    const content = '## Health Check Path\n/ready\n\n## Start Dev Server\nbun start\n';
    const result = parseCommandsMd(content);
    expect(result.healthCheckPath).toBe('/ready');
    expect(result.startDevServer).toBe('bun start');
  });

  it('trims whitespace from the healthCheckPath value', () => {
    const content = '## Health Check Path\n  /health  \n';
    const result = parseCommandsMd(content);
    expect(result.healthCheckPath).toBe('/health');
  });
});

describe('getDefaultCommandsConfig — healthCheckPath', () => {
  it('includes healthCheckPath defaulting to "/"', () => {
    const defaults = getDefaultCommandsConfig();
    expect(defaults.healthCheckPath).toBe('/');
  });
});

describe('loadProjectConfig — healthCheckPath integration', () => {
  it('returns healthCheckPath from .adw/commands.md when present', () => {
    // Create a temporary directory simulating a target repository
    const tmpDir = mkdtempSync(join(tmpdir(), 'adw-test-'));
    const adwDir = join(tmpDir, '.adw');
    mkdirSync(adwDir);
    writeFileSync(
      join(adwDir, 'commands.md'),
      '## Health Check Path\n/ready\n',
      'utf-8',
    );

    const config = loadProjectConfig(tmpDir);
    expect(config.commands.healthCheckPath).toBe('/ready');
  });

  it('defaults healthCheckPath to "/" when commands.md has no Health Check Path section', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'adw-test-'));
    const adwDir = join(tmpDir, '.adw');
    mkdirSync(adwDir);
    writeFileSync(join(adwDir, 'commands.md'), '## Start Dev Server\nbun run dev\n', 'utf-8');

    const config = loadProjectConfig(tmpDir);
    expect(config.commands.healthCheckPath).toBe('/');
  });
});
