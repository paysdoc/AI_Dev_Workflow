import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { ADW_YML_TEMPLATE } from '../core/adwYmlConfig';
import { APPLICATION_TYPE_PROFILES } from '../core/applicationType';
import {
  ADW_PLAYWRIGHT_PROJECT_FILES,
  ADW_PLAYWRIGHT_RUN_BY_TAG,
  ADW_PLAYWRIGHT_SETUP_COMMAND,
  ADW_PLAYWRIGHT_TEMPLATE_DIR,
  ProjectFilePolicy,
} from '../core/adwPlaywrightProject';
import { REQUIRED_ADW_FILES } from '../phases/worktreeSetup';

/**
 * `adw_init.md` is a prompt, so it cannot import the texts it must reproduce in a target
 * repository, nor the application types ADW knows. These tests compare it with their sources
 * so a drift fails here instead of surfacing as a stale `.github/adw.yml` or guideline, or as
 * an application type the mapping would park, in every target.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const ADW_INIT_PATH = path.join(REPO_ROOT, '.claude/commands/adw_init.md');
const CODING_GUIDELINES_PATH = path.join(REPO_ROOT, '.adw/coding_guidelines.md');
const HEREDOC_OPENER = "cat > .github/adw.yml <<'EOF'";
const COMMENTS_ENTRY_PREFIX = '- **Comments** —';
const APPLICATION_TYPE_SECTION = '## Application Type';
const APPLICATION_TYPE_BULLET_PREFIX = `- \`${APPLICATION_TYPE_SECTION}\``;

function readLines(filePath: string): string[] {
  return fs.readFileSync(filePath, 'utf-8').split('\n');
}

/** The lines of step 3, which writes `.adw/project.md`: from its heading up to the heading of step 4. */
function projectMdStep(lines: readonly string[]): string[] {
  const start = lines.findIndex((line) => /^3\. \*\*/.test(line));
  const end = lines.findIndex((line) => /^4\. \*\*/.test(line));
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return lines.slice(start, end);
}

/** The lines of step `n`: from its heading up to the heading of the next step, or the end of the prompt. */
function stepLines(lines: readonly string[], n: number): string[] {
  const start = lines.findIndex((line) => line.startsWith(`${n}. **`));
  const end = lines.findIndex((line) => line.startsWith(`${n + 1}. **`));
  expect(start).toBeGreaterThanOrEqual(0);
  return lines.slice(start, end === -1 ? undefined : end);
}

/** The values of the `hashInputs:` list in the prompt's frontmatter. */
function hashInputs(lines: readonly string[]): string[] {
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  const frontmatter = lines.slice(1, closing);
  const key = frontmatter.findIndex((line) => line.startsWith('hashInputs:'));
  expect(key).toBeGreaterThanOrEqual(0);
  const items: string[] = [];
  for (const line of frontmatter.slice(key + 1)) {
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (!item) break;
    items.push(item[1].trim());
  }
  return items;
}

function findCommentsEntry(lines: readonly string[]): string | undefined {
  return lines.map((line) => line.trim()).find((line) => line.startsWith(COMMENTS_ENTRY_PREFIX));
}

describe('adw_init.md reproduces the texts it cannot import', () => {
  it('writes a .github/adw.yml heredoc byte-identical to ADW_YML_TEMPLATE', () => {
    const lines = readLines(ADW_INIT_PATH);
    const opener = lines.findIndex((line) => line.endsWith(HEREDOC_OPENER));
    expect(opener).toBeGreaterThanOrEqual(0);
    const closer = lines.indexOf('EOF', opener + 1);
    expect(closer).toBeGreaterThan(opener);

    const heredoc = `${lines.slice(opener + 1, closer).join('\n')}\n`;

    expect(heredoc).toBe(ADW_YML_TEMPLATE);
  });

  it("carries the Comments entry of ADW's own coding guidelines", () => {
    const fromPrompt = findCommentsEntry(readLines(ADW_INIT_PATH));
    const fromGuidelines = findCommentsEntry(readLines(CODING_GUIDELINES_PATH));

    expect(fromPrompt).toBeDefined();
    expect(fromGuidelines).toBeDefined();
    expect(fromPrompt).toBe(fromGuidelines);
  });

  it('offers exactly the application types the mapping knows', () => {
    const bullet = projectMdStep(readLines(ADW_INIT_PATH)).map((line) => line.trim()).find((line) => line.startsWith(APPLICATION_TYPE_BULLET_PREFIX));
    expect(bullet).toBeDefined();

    const offered = [...(bullet ?? '').matchAll(/`([^`]+)`/g)].map((match) => match[1]).filter((token) => token !== APPLICATION_TYPE_SECTION);

    expect([...offered].sort()).toEqual(Object.keys(APPLICATION_TYPE_PROFILES).sort());
  });

  it('says to leave the section out when detection cannot decide, so that no default is ever written', () => {
    expect(projectMdStep(readLines(ADW_INIT_PATH)).join('\n')).toContain('leave the section out');
  });

  it('says to preserve a type the owner set by hand, so that an upgrade does not drop it', () => {
    expect(projectMdStep(readLines(ADW_INIT_PATH)).join('\n')).toContain('preserve it verbatim');
  });
});

describe("adw_init.md installs ADW's Playwright project for a web repository", () => {
  const prompt = (): string => fs.readFileSync(ADW_INIT_PATH, 'utf-8');
  const templatesDir = path.join(REPO_ROOT, ADW_PLAYWRIGHT_TEMPLATE_DIR);
  const regressionCommand = ADW_PLAYWRIGHT_RUN_BY_TAG.replace('{tag}', 'regression');

  it('lists every template in hashInputs, so that editing one upgrades every target repository', () => {
    const listed = hashInputs(readLines(ADW_INIT_PATH));
    const templates = fs
      .readdirSync(templatesDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => `templates/playwright/${entry.name}`);

    expect(templates.length).toBeGreaterThan(0);
    for (const template of templates) expect(listed).toContain(template);
  });

  it('lists only hashInputs files that exist, so that the framework hash can be computed', () => {
    for (const input of hashInputs(readLines(ADW_INIT_PATH))) {
      expect(fs.existsSync(path.join(REPO_ROOT, input))).toBe(true);
    }
  });

  it("writes ADW's run-by-tag command to .adw/commands.md and .adw/scenarios.md, and the same command for @regression", () => {
    expect(prompt()).toContain(ADW_PLAYWRIGHT_RUN_BY_TAG);
    expect(prompt()).toContain(regressionCommand);
  });

  it('writes playwright-bdd and features/steps as the BDD framework and the step definition directory of a web repository', () => {
    const web = stepLines(readLines(ADW_INIT_PATH), 8).join('\n');

    expect(web).toContain('`playwright-bdd`');
    expect(web).toContain('`features/steps`');
    expect(web).toContain(ADW_PLAYWRIGHT_RUN_BY_TAG);
    expect(web).toContain(regressionCommand);
  });

  it('puts the web branch of step 8 before the Cypress and Cucumber branches, which apply otherwise', () => {
    const step = stepLines(readLines(ADW_INIT_PATH), 8).join('\n');

    expect(step.indexOf('`web`')).toBeGreaterThan(-1);
    expect(step.indexOf('`web`')).toBeLessThan(step.indexOf('**Cypress**'));
    expect(step.indexOf('**Cypress**')).toBeLessThan(step.indexOf('**Cucumber**'));
  });

  it("copies each of the project's templates to its target in step 6, with the policy the table gives it", () => {
    const step6 = stepLines(readLines(ADW_INIT_PATH), 6);
    expect(step6.join('\n')).toContain('Playwright project');

    for (const { template, target, policy } of ADW_PLAYWRIGHT_PROJECT_FILES) {
      const line = step6.find((candidate) => candidate.includes(`"$3/${ADW_PLAYWRIGHT_TEMPLATE_DIR}/${template}"`) && candidate.includes(target));
      expect(line, `step 6 copies ${template} to ${target}`).toBeDefined();
      if (policy === ProjectFilePolicy.CreateIfAbsent) expect(line).toContain(`[ -f ${target} ] ||`);
      if (policy === ProjectFilePolicy.AppendMissingLines) expect(line).toContain('grep -qxF');
      if (policy === ProjectFilePolicy.Overwrite) expect(line).not.toContain('[ -f');
    }
  });

  it('installs the packages and the browser with the command the upgrade runs after the agent', () => {
    const step6 = stepLines(readLines(ADW_INIT_PATH), 6).join('\n');

    expect(step6).toContain(ADW_PLAYWRIGHT_SETUP_COMMAND);
  });

  it('skips step 6 for a type other than web, and for an empty $3', () => {
    const step6 = stepLines(readLines(ADW_INIT_PATH), 6).join('\n');

    expect(step6).toContain('not applicable');
    expect(step6).toContain('`$3`');
  });

  it("leaves the repository's own e2e setup alone and never edits the owned configuration", () => {
    const step6 = stepLines(readLines(ADW_INIT_PATH), 6).join('\n');

    expect(step6).toContain('left exactly as it is');
    expect(step6).toContain('never add a `webServer` block');
  });

  it('no longer has the Playwright branch of step 8 that ran bunx playwright over tests/e2e/', () => {
    expect(prompt()).not.toContain('bunx playwright test --grep');
    expect(prompt()).not.toContain('tests/e2e/');
  });

  it('names no .adw/ file but those adw_init writes', () => {
    const named = [...prompt().matchAll(/\.adw\/([\w-]+\.md)/g)].map((match) => match[1]);

    expect(named.length).toBeGreaterThan(0);
    for (const file of named) expect([...REQUIRED_ADW_FILES, 'coding_guidelines.md']).toContain(file);
  });

  it('no longer turns off the dev server of a repository whose own Playwright has a webServer block', () => {
    const step2 = stepLines(readLines(ADW_INIT_PATH), 2).join('\n');

    expect(step2).not.toContain('Playwright with a `webServer` block');
    expect(step2).not.toMatch(/webServer[^\n]*`N\/A`/);
  });

  it("gives a web repository the framework's dev command with {PORT}, whatever test runners it has", () => {
    const step2 = stepLines(readLines(ADW_INIT_PATH), 2).join('\n');

    expect(step2).toContain('`web`');
    expect(step2).toContain('{PORT}');
    expect(step2).toContain('whatever test runners the repository has');
  });

  it('reports the Playwright project in step 11', () => {
    const step11 = stepLines(readLines(ADW_INIT_PATH), 11).join('\n');

    expect(step11).toContain('Playwright project');
  });

  it('keeps the numbering of the steps, so that every reference to a step stays valid', () => {
    const lines = readLines(ADW_INIT_PATH);
    const headings = lines.filter((line) => /^\d+\. \*\*/.test(line)).map((line) => Number(line.split('.')[0]));

    expect(headings).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('describes $3 as also locating the Playwright templates', () => {
    const variable = readLines(ADW_INIT_PATH).find((line) => line.startsWith('frameworkRepoRoot: $3'));

    expect(variable).toBeDefined();
    expect(variable).toContain('templates/playwright');
  });
});
