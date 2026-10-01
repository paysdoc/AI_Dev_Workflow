import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { ADW_CLASSIFICATION_LABELS, resolveAdwLabelDefinition } from '../core/adwLabels';
import { issueTypeToOrchestratorMap } from '../types/issueRouting';

/**
 * Contract guard: ADW routes an issue by its `adw:*` label, never by a command in its body.
 * The triage skill files a major-upgrade issue that must reach the full SDLC, so it has to
 * apply `adw:bug` in the create call and carry no orchestrator command in the body.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = path.resolve(__dirname, '../../.claude/skills/depaudit-triage/SKILL.md');

describe('depaudit-triage skill — major-upgrade issue routing contract', () => {
  const content = fs.readFileSync(SKILL_PATH, 'utf-8');

  it('names no orchestrator command anywhere in the skill', () => {
    expect(content).not.toMatch(/\/adw_[a-z_]+/);
  });

  it('files the issue with the adw:bug label in the create call', () => {
    expect(content).toContain('gh issue create --title <title> --body <body> --label adw:bug');
  });

  it('creates adw:bug first, with the catalogue\'s own colour and description', () => {
    const definition = resolveAdwLabelDefinition('adw:bug');

    expect(content).toContain(`gh label create 'adw:bug' --color ${definition.color} --description '${definition.description}' --force`);
  });

  it('routes adw:bug to the full SDLC orchestrator', () => {
    expect(ADW_CLASSIFICATION_LABELS['adw:bug']).toBe('/bug');
    expect(issueTypeToOrchestratorMap['/bug']).toBe('adws/adwSdlc.tsx');
  });
});
