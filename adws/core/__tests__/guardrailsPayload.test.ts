import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
  buildGuardrailsSettings,
  serializeGuardrailsSettings,
  resolveHookLogDir,
} from '../guardrailsPayload';

// The real templates/claude-settings-starter.json — this repo IS the framework repo root
// when vitest runs, so this exercises the actual template on disk (not a fixture copy).
const FRAMEWORK_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

describe('guardrailsPayload', () => {
  describe('buildGuardrailsSettings', () => {
    const settings = buildGuardrailsSettings({ frameworkRepoRoot: FRAMEWORK_REPO_ROOT });

    it('parses all 13 deny patterns from the template', () => {
      expect(settings.permissions.deny).toHaveLength(13);
    });

    it('carries a deny rule for recursive-force removal', () => {
      expect(settings.permissions.deny).toContain('Bash(rm -rf:*)');
    });

    it('carries a deny rule for force pushing', () => {
      expect(settings.permissions.deny).toContain('Bash(git push -f:*)');
      expect(settings.permissions.deny).toContain('Bash(git push*--force*)');
    });

    it('carries a deny rule for reading environment secrets, carving out the sample files', () => {
      expect(settings.permissions.deny).toContain('Read(**/.env*)');
      expect(settings.permissions.deny).toContain('Read(!**/.env.sample)');
      expect(settings.permissions.deny).toContain('Read(!**/.env.example)');
    });

    it('declares no allow list', () => {
      expect((settings.permissions as Record<string, unknown>)['allow']).toBeUndefined();
    });

    it('registers all five hook events', () => {
      expect(Object.keys(settings.hooks).sort()).toEqual(
        ['Notification', 'PostToolUse', 'PreToolUse', 'Stop', 'SubagentStop'].sort(),
      );
    });

    it('registers every hook command at an absolute path under the given frameworkRepoRoot', () => {
      for (const entries of Object.values(settings.hooks)) {
        for (const entry of entries) {
          for (const hook of entry.hooks) {
            expect(hook.command).toContain(`bun ${FRAMEWORK_REPO_ROOT}`);
            expect(path.isAbsolute(FRAMEWORK_REPO_ROOT)).toBe(true);
          }
        }
      }
    });

    it('uses bun directly, not bunx tsx', () => {
      for (const entries of Object.values(settings.hooks)) {
        for (const entry of entries) {
          for (const hook of entry.hooks) {
            expect(hook.command).not.toContain('bunx tsx');
            expect(hook.command.startsWith('bun ')).toBe(true);
          }
        }
      }
    });

    it('keeps every hook command non-blocking (|| true)', () => {
      for (const entries of Object.values(settings.hooks)) {
        for (const entry of entries) {
          for (const hook of entry.hooks) {
            expect(hook.command).toMatch(/\|\| true$/);
          }
        }
      }
    });

    it('passes --notify to the Notification hook and --chat to the Stop hook only', () => {
      expect(settings.hooks.Notification[0]?.hooks[0]?.command).toContain('--notify');
      expect(settings.hooks.Stop[0]?.hooks[0]?.command).toContain('--chat');
      expect(settings.hooks.PreToolUse[0]?.hooks[0]?.command).not.toContain('--notify');
      expect(settings.hooks.PreToolUse[0]?.hooks[0]?.command).not.toContain('--chat');
      expect(settings.hooks.PostToolUse[0]?.hooks[0]?.command).not.toContain('--notify');
      expect(settings.hooks.SubagentStop[0]?.hooks[0]?.command).not.toContain('--notify');
    });
  });

  describe('serializeGuardrailsSettings', () => {
    it('round-trips through JSON', () => {
      const settings = buildGuardrailsSettings({ frameworkRepoRoot: FRAMEWORK_REPO_ROOT });
      const json = serializeGuardrailsSettings(settings);
      expect(JSON.parse(json)).toEqual(settings);
    });
  });

  describe('resolveHookLogDir', () => {
    it('returns an absolute path under agents/{adwId}/hook-logs', () => {
      const dir = resolveHookLogDir('abc123-my-adw-id');
      expect(path.isAbsolute(dir)).toBe(true);
      expect(dir.endsWith(path.join('agents', 'abc123-my-adw-id', 'hook-logs'))).toBe(true);
    });
  });
});
