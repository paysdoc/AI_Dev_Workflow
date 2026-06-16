import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Contract guard for the #592 incident: the SDLC PR template must instruct the
 * agent to emit the bare `Implements #<issueNumber>` marker that ADW's
 * linked-PR detectors (hitlBoardNotifier, linkedPrDetector, perIssueScenarioSweep)
 * match on. Dropping it silently disables HITL review notifications and the
 * per-issue scenario retention clock for every normal SDLC PR.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.resolve(__dirname, '../../.claude/commands/pull_request.md');

describe('pull_request.md PR-body marker contract', () => {
  const content = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

  it('instructs emitting the bare `Implements #<issueNumber>` marker', () => {
    expect(content).toContain('Implements #<issueNumber>');
  });

  it('still instructs emitting a `Closes` keyword for GitHub auto-close', () => {
    expect(content).toMatch(/Closes (repoOwner\/repoName)?#<issueNumber>/);
  });
});
