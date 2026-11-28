import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { APPLICATION_TYPE_PROFILES } from '../core/applicationType';
import { parseBoundaryList, type BoundaryList } from '../core/boundaryList';
import { runShellCommand } from '../core/checkRunner';
import { parseMarkdownSections } from '../core/markdownSections';
import { ADW_INIT_PATH, REPO_ROOT, bulletLines, fencedBlockAfter, readLines, stepLines } from './adwInitPrompt.helpers';

/**
 * `adw_init.md` writes a repository's Real Boundaries and copies its Regression Suite registry, and a prompt cannot import the
 * code that reads what it writes. These tests compare what the prompt writes with that code, and run the copy command it gives.
 */
const REAL_BOUNDARIES_BULLET = '- **Write the `## Real Boundaries` section**';
const MOBILE_BRANCH = '- If the application type is **`mobile:kotlincm`**';
const COPY_BULLET = '- **Copy the framework vocabulary template**';
const REGISTRY_REPORT = '- `features/regression/vocabulary.md`:';
const COMMENT_MARKER = 'then this comment, exactly as written';
const ENTRIES_MARKER = 'The boundary entries:';
const TEMPLATE_COPY = 'cp "$3/templates/vocabulary.md.template"';
const REGISTRY_CHECK = '[ -f features/regression/vocabulary.md ]';
const REGISTRY = 'features/regression/vocabulary.md';
const TEMPLATE_PATH = path.join(REPO_ROOT, 'templates/vocabulary.md.template');
const ADW_SCENARIOS_PATH = path.join(REPO_ROOT, '.adw/scenarios.md');
const REAL_BOUNDARIES_HEADING = '## Real Boundaries';
const EXAMPLES_HEADING = '## Observability Surfaces (Examples)';
const EXECUTION_HEADING = '## Execution at a Real Boundary';
const EXAMPLES_PLACEHOLDER = '<!-- TODO (slice #3, issue ??):';
const SPELLED_OUT_NAMES = ['cli', 'http', 'package', 'browser', 'app'];
const MAPPING_LINE = /^\s*- `([^`]+)` → (.+)$/;
const HTML_COMMENT = /<!--[\s\S]*?-->/;
const EXISTING_REGISTRY = [
  '# Regression Vocabulary Registry',
  '',
  '## Given — Setup',
  '',
  '| # | Phrase | Semantics |',
  '|---|--------|-----------|',
  '| G1 | `the owner registered a phrase of their own` | A phrase a Promotion added to this repository |',
  '',
].join('\n');

interface TypeMapping {
  readonly type: string;
  readonly names: readonly string[];
}

const step8 = (): string[] => stepLines(readLines(ADW_INIT_PATH), 8);
const step11 = (): string[] => stepLines(readLines(ADW_INIT_PATH), 11);
const realBoundariesBullet = (): string[] => bulletLines(step8(), REAL_BOUNDARIES_BULLET);
const isBlank = (line: string): boolean => line.trim() === '';

function codeSpans(line: string): string[] {
  return [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

/** A line of the bullet that maps an application type the mapping knows to the entries it gets, in the order the line names them. */
function mappingOf(line: string): TypeMapping[] {
  const mapping = MAPPING_LINE.exec(line);
  if (!mapping || !Object.keys(APPLICATION_TYPE_PROFILES).includes(mapping[1])) return [];
  return [{ type: mapping[1], names: [...new Set(codeSpans(mapping[2]))] }];
}

const typeMappings = (): TypeMapping[] => realBoundariesBullet().flatMap(mappingOf);
const mappedNames = (): string[] => typeMappings().flatMap(({ names }) => names);

function namesMappedTo(type: string): readonly string[] {
  return typeMappings().find((mapping) => mapping.type === type)?.names ?? [];
}

/** The section the bullet writes for a repository of every kind at once: its heading, its comment and every entry it spells out. */
function spelledOutList(): BoundaryList {
  const bullet = realBoundariesBullet();
  const section = [REAL_BOUNDARIES_HEADING, ...fencedBlockAfter(bullet, COMMENT_MARKER), ...fencedBlockAfter(bullet, ENTRIES_MARKER)];
  return parseBoundaryList(section.join('\n'));
}

function spelledOutNames(): string[] {
  const list = spelledOutList();
  return list.kind === 'declared' ? list.boundaries.map(({ name }) => name) : [];
}

/** A `.adw/scenarios.md` with a value under every section step 8 names but `## Real Boundaries`. */
function scenariosMdWithoutRealBoundaries(): string {
  const headings = step8()
    .flatMap(codeSpans)
    .filter((span) => span.startsWith('## ') && span !== REAL_BOUNDARIES_HEADING);
  return [...new Set(headings)].map((heading) => `${heading}\nvalue`).join('\n\n');
}

/** The copy command of step 8, with `$3` replaced by the framework's root as Claude Code substitutes it. */
function copyCommand(): string {
  return fencedBlockAfter(step8(), COPY_BULLET).join('\n').split('$3').join(REPO_ROOT);
}

describe('adw_init.md writes the Real Boundaries list from the application type', () => {
  it('gives every application type the mapping knows at least one boundary entry', () => {
    const unmapped = Object.keys(APPLICATION_TYPE_PROFILES).filter((type) => namesMappedTo(type).length === 0);

    expect(unmapped, 'application types no line of the bullet gives an entry').toEqual([]);
  });

  it('names only entries the prompt spells out', () => {
    const spelledOut = spelledOutNames();

    expect(spelledOut.length).toBeGreaterThan(0);
    expect(mappedNames().filter((name) => !spelledOut.includes(name))).toEqual([]);
  });

  it('offers every spelled-out entry to some application type', () => {
    expect([...new Set(mappedNames())].sort()).toEqual([...spelledOutNames()].sort());
  });

  it('spells out entries that parse as a declared list with no malformed entry', () => {
    const list = spelledOutList();
    const boundaries = list.kind === 'declared' ? list.boundaries : [];

    expect(list).toMatchObject({ kind: 'declared', malformedEntries: [] });
    expect(boundaries.map(({ name }) => name)).toEqual(SPELLED_OUT_NAMES);
    expect(boundaries.filter(({ description }) => description === ''), 'entries without a description').toEqual([]);
  });

  it('gives a cli repository the cli entry first, the one it falls back to', () => {
    expect(namesMappedTo('cli')[0]).toBe('cli');
  });

  it("writes the comment of ADW's own list, so that every target documents the entry format the same way", () => {
    const ownSection = parseMarkdownSections(fs.readFileSync(ADW_SCENARIOS_PATH, 'utf-8'))['real boundaries'] ?? '';
    const ownComment = HTML_COMMENT.exec(ownSection)?.[0];

    expect(ownComment, "the comment of ## Real Boundaries in ADW's own .adw/scenarios.md").toBeDefined();
    expect(fencedBlockAfter(realBoundariesBullet(), COMMENT_MARKER).join('\n')).toBe(ownComment);
  });

  it('keeps a list the repository already has, even an empty one, so that an upgrade never resets it', () => {
    const bullet = realBoundariesBullet().join('\n');

    expect(bullet).toContain('preserve it verbatim');
    expect(bullet).toContain('even when it lists none');
  });

  it('leaves the section out when the application type is undecided, so that the list reads as absent', () => {
    expect(realBoundariesBullet().join('\n')).toContain('leave this section out too');
    expect(parseBoundaryList(scenariosMdWithoutRealBoundaries())).toEqual({ kind: 'absent' });
  });

  it('sits outside the mobile:kotlincm branch, whose descriptor bullets the regression suite reads', () => {
    const lines = step8();
    const branchStart = lines.findIndex((line) => line.trimStart().startsWith(MOBILE_BRANCH));
    const branchEnd = branchStart + bulletLines(lines, MOBILE_BRANCH).length;
    const bulletStart = lines.findIndex((line) => line.trimStart().startsWith(REAL_BOUNDARIES_BULLET));

    expect(bulletStart, 'the bullet starts after the last line of the mobile:kotlincm branch').toBeGreaterThanOrEqual(branchEnd);
    expect(realBoundariesBullet().filter((line) => line.trimStart().startsWith('- `## '))).toEqual([]);
  });

  it('reports the Real Boundaries outcome in step 11', () => {
    const report = step11().find((line) => line.includes(`\`${REAL_BOUNDARIES_HEADING}\``));

    expect(report, 'step 11 reports the ## Real Boundaries section').toBeDefined();
    for (const outcome of ['`written`', '`preserved`', 'left out']) expect(report).toContain(outcome);
  });
});

describe('adw_init.md copies the vocabulary template only into a repository that has no registry', () => {
  it('guards every copy of the template with a check that the registry is absent', () => {
    const copies = step8().filter((line) => line.includes(TEMPLATE_COPY));

    expect(copies.length).toBeGreaterThan(0);
    expect(copies.filter((line) => !line.includes(REGISTRY_CHECK))).toEqual([]);
  });

  describe('the copy command, run in the root of a scratch repository', () => {
    let workDir = '';

    beforeEach(() => {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-vocabulary-'));
    });

    afterEach(() => {
      fs.rmSync(workDir, { recursive: true, force: true });
    });

    const registryPath = (): string => path.join(workDir, REGISTRY);

    it('copies the template into a repository that has no registry', async () => {
      const outcome = await runShellCommand(copyCommand(), workDir);

      expect(outcome.exitCode).toBe(0);
      expect(outcome.output).toContain('vocabulary copied');
      expect(fs.readFileSync(registryPath(), 'utf-8')).toBe(fs.readFileSync(TEMPLATE_PATH, 'utf-8'));
    });

    it('keeps an existing registry byte for byte', async () => {
      fs.mkdirSync(path.dirname(registryPath()), { recursive: true });
      fs.writeFileSync(registryPath(), EXISTING_REGISTRY);

      const outcome = await runShellCommand(copyCommand(), workDir);

      expect(outcome.exitCode).toBe(0);
      expect(outcome.output).toContain('vocabulary kept');
      expect(fs.readFileSync(registryPath(), 'utf-8')).toBe(EXISTING_REGISTRY);
    });
  });

  it('drafts the examples block only into a template it copied in this run', () => {
    const step = step8().join('\n');

    expect(step).toContain('printed `vocabulary copied`');
    expect(step).toContain('skip this drafting');
  });

  it('locates the examples placeholder between the headings the template puts around it', () => {
    const step = step8().join('\n');
    const template = readLines(TEMPLATE_PATH);
    const examples = template.indexOf(EXAMPLES_HEADING);
    const placeholder = template.findIndex((line) => line.startsWith(EXAMPLES_PLACEHOLDER));
    const execution = template.indexOf(EXECUTION_HEADING);

    expect(step).toContain(`\`${EXAMPLES_HEADING}\``);
    expect(step).toContain(`\`${EXECUTION_HEADING}\``);
    expect(examples).toBeGreaterThanOrEqual(0);
    expect(placeholder).toBeGreaterThan(examples);
    expect(execution).toBeGreaterThan(placeholder);
    expect(template.slice(examples + 1, placeholder).every(isBlank), 'only blank lines between the heading and the placeholder').toBe(true);
    expect(template.slice(placeholder + 1, execution).every(isBlank), 'only blank lines between the placeholder and the next heading').toBe(true);
  });

  it('reports whether the registry was copied, kept or skipped in step 11', () => {
    const report = step11().find((line) => line.trimStart().startsWith(REGISTRY_REPORT));

    expect(report, 'step 11 reports features/regression/vocabulary.md').toBeDefined();
    for (const outcome of ['`copied`', '`kept`', '`skipped`']) expect(report).toContain(outcome);
  });
});
