import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { RunnerMode } from '../core/applicationType';
import { ADW_PLAYWRIGHT_INSTALL_COMMAND, ADW_PLAYWRIGHT_STEP_DEF_DIR } from '../core/adwPlaywrightProject';

/**
 * `generate_step_definitions.md` is a prompt, so it cannot import the runner modes ADW passes it nor the directory of
 * ADW's Playwright project. These tests compare it with their sources, so that a drift fails here instead of showing as
 * step definitions in the wrong idiom or directory in every web repository.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const PROMPT_PATH = path.join(REPO_ROOT, '.claude/commands/generate_step_definitions.md');
const SCENARIO_WRITER_PATH = path.join(REPO_ROOT, '.claude/commands/scenario_writer.md');

const prompt = fs.readFileSync(PROMPT_PATH, 'utf-8');
const lines = prompt.split('\n');

/** From a heading up to the next heading of the same or a higher level, or the end of the prompt. */
function section(heading: string): string {
  const level = heading.match(/^#+/)?.[0].length ?? 0;
  const start = lines.findIndex((line) => line.trim() === heading);
  expect(start, `the prompt has a "${heading}" section`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((line, index) => index > start && new RegExp(`^#{1,${level}} `).test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

describe('generate_step_definitions.md takes the scenario runner mode as $2', () => {
  it('documents $2 among its arguments, with the values ADW passes and what empty means', () => {
    const args = section('## Arguments');

    expect(args).toContain('`$2`');
    expect(args).toMatch(/empty means `descriptor`/i);
  });

  it.each(Object.values(RunnerMode))('names the runner mode %s', (mode) => {
    expect(prompt).toContain(`\`${mode}\``);
  });

  it('names no runner mode ADW does not pass', () => {
    const named = [...prompt.matchAll(/`(adw_[a-z_]+|descriptor)`/g)].map((match) => match[1]);

    expect(new Set(named)).toEqual(new Set(Object.values(RunnerMode)));
  });

  it('puts the runner mode section before the polymorphism on .adw/scenarios.md', () => {
    expect(prompt.indexOf('## Runner mode')).toBeGreaterThan(-1);
    expect(prompt.indexOf('## Runner mode')).toBeLessThan(prompt.indexOf('## Polymorphism on `.adw/scenarios.md`'));
  });
});

describe("generate_step_definitions.md in adw_playwright mode writes steps for ADW's Playwright project", () => {
  const mode = (): string => section('## Runner mode');

  it('registers steps with createBdd() from playwright-bdd', () => {
    expect(mode()).toContain('createBdd()');
    expect(mode()).toContain("from 'playwright-bdd'");
  });

  it('writes TypeScript under the directory the project loads, whatever .adw/scenarios.md says', () => {
    expect(mode()).toContain(`\`${ADW_PLAYWRIGHT_STEP_DEF_DIR}/\``);
    expect(mode()).toMatch(/whatever `## BDD Framework` and `## Step Def Directory` say/);
  });

  it('takes the page fixture in every step that looks at or acts on what a user sees', () => {
    expect(mode()).toContain('{ page }');
    expect(mode()).toMatch(/end-state screenshot/);
  });

  it('lets a step about pure logic or an HTTP API take request instead', () => {
    expect(mode()).toContain('`request`');
  });

  it("navigates by relative path, never with a host or port, a server of its own or a webServer block", () => {
    expect(mode()).toContain("page.goto('/')");
    expect(mode()).toContain('ADW_APPLICATION_URL');
    expect(mode()).toMatch(/Never hard-code a host or port, start a server, or add a `webServer` block/);
  });

  it('uses Cucumber expressions and expect from @playwright/test', () => {
    expect(mode()).toContain('{string}');
    expect(mode()).toContain("from '@playwright/test'");
  });

  it('never edits the configuration or the gitignore, which ADW owns', () => {
    expect(mode()).toContain('`features/playwright.config.ts`');
    expect(mode()).toContain('`features/.gitignore`');
    expect(mode()).toMatch(/ADW owns them/);
  });

  it('leaves the mock infrastructure of section 5 to the descriptor runner', () => {
    expect(mode()).toMatch(/Section 5/);
  });

  it('keeps every other mode of the prompt exactly as written for descriptor, or an empty $2', () => {
    expect(mode()).toMatch(/`descriptor`, or empty/);
    expect(mode()).toContain('applies exactly as written');
  });
});

describe('generate_step_definitions.md checks its steps with bddgen in adw_playwright mode', () => {
  const check = `${ADW_PLAYWRIGHT_INSTALL_COMMAND} && npx bddgen`;

  it('runs the install-and-generate part of the run command', () => {
    expect(prompt).toContain(check);
  });

  it('puts the check in the verify step, as the one exception to the rule against loading step files', () => {
    const verify = section('### 7. Verify');

    expect(verify).toContain(check);
    expect(verify).toMatch(/the one exception to the rule against loading step files/);
  });

  it('never runs bddgen without the install guard, and never runs the scenarios', () => {
    const verify = section('### 7. Verify');

    expect(verify).toMatch(/never run `npx bddgen` without the install guard/i);
    expect(verify).toMatch(/do not run `npx playwright test`/i);
  });

  it('reads every .ts file of the project directory, since a pattern registered twice fails bddgen', () => {
    const read = section('### 3. Read existing step definitions');

    expect(read).toContain('adw_playwright');
    expect(read).toContain(`${ADW_PLAYWRIGHT_STEP_DEF_DIR}/`);
  });
});

describe('generate_step_definitions.md keeps what both modes share', () => {
  it('validates the vocabulary registry in both modes', () => {
    expect(prompt).toMatch(/Vocabulary Registry[^\n]*(both modes|applies in both)/i);
  });

  it('keeps the output JSON unchanged', () => {
    const output = section('### 8. Output');

    expect(output).toContain('"generatedFiles"');
    expect(output).toContain('"removedScenarios"');
    expect(output).toContain('"vocabularyViolations"');
  });

  it('leaves the scenario writer to say nothing about the runner mode', () => {
    const scenarioWriter = fs.readFileSync(SCENARIO_WRITER_PATH, 'utf-8');

    for (const mode of Object.values(RunnerMode)) expect(scenarioWriter).not.toContain(`\`${mode}\``);
  });
});
