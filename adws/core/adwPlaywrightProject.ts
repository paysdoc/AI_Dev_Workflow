import * as fs from 'fs';
import * as path from 'path';

export const ADW_PLAYWRIGHT_PROJECT_DIR = 'features';
export const ADW_PLAYWRIGHT_STEP_DEF_DIR = 'features/steps';
export const ADW_PLAYWRIGHT_TEMPLATE_DIR = path.join('templates', 'playwright');

/** The first install in a repository: it writes `features/package-lock.json` and downloads Chromium. */
export const ADW_PLAYWRIGHT_SETUP_COMMAND = 'cd features && npm install --no-audit --no-fund && npx playwright install chromium';

export const ADW_PLAYWRIGHT_INSTALL_COMMAND = 'cd features && (test -d node_modules || npm ci)';

// The install guard runs first: a worktree has no features/node_modules, and npx would otherwise resolve bddgen on the registry without asking.
// \b keeps @adw-99 from selecting @adw-992, because --grep is a regular expression over the title and the tags.
export const ADW_PLAYWRIGHT_RUN_BY_TAG = `${ADW_PLAYWRIGHT_INSTALL_COMMAND} && npx bddgen && npx playwright test --grep "@{tag}\\b"`;

export enum ProjectFilePolicy {
  Overwrite = 'overwrite',
  CreateIfAbsent = 'create_if_absent',
  AppendMissingLines = 'append_missing_lines',
}

export interface AdwPlaywrightProjectFile {
  readonly template: string;
  /** Relative to the repository root. */
  readonly target: string;
  readonly policy: ProjectFilePolicy;
}

export const ADW_PLAYWRIGHT_PROJECT_FILES: readonly AdwPlaywrightProjectFile[] = [
  { template: 'playwright.config.ts.template', target: 'features/playwright.config.ts', policy: ProjectFilePolicy.Overwrite },
  // Step definitions may need packages the owner adds, so an existing manifest is theirs.
  { template: 'package.json.template', target: 'features/package.json', policy: ProjectFilePolicy.CreateIfAbsent },
  { template: 'gitignore.template', target: 'features/.gitignore', policy: ProjectFilePolicy.AppendMissingLines },
];

export type ProjectFileAction = 'written' | 'kept' | 'appended';

export interface ProjectFileOutcome {
  readonly target: string;
  readonly action: ProjectFileAction;
}

/** Returns `existing` itself when it already holds every non-empty template line, so a second run changes nothing. */
export function appendMissingLines(existing: string, template: string): string {
  const present = new Set(existing.split('\n').map(line => line.trim()));
  const missing = template
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !present.has(line));
  if (missing.length === 0) return existing;

  const separator = existing === '' || existing.endsWith('\n') ? '' : '\n';
  return `${existing}${separator}${missing.join('\n')}\n`;
}

function overwrite(targetPath: string, template: Buffer): ProjectFileAction {
  fs.writeFileSync(targetPath, template);
  return 'written';
}

function createIfAbsent(targetPath: string, template: Buffer): ProjectFileAction {
  if (fs.existsSync(targetPath)) return 'kept';
  fs.writeFileSync(targetPath, template);
  return 'written';
}

function appendMissing(targetPath: string, template: Buffer): ProjectFileAction {
  if (!fs.existsSync(targetPath)) {
    fs.writeFileSync(targetPath, template);
    return 'written';
  }
  const existing = fs.readFileSync(targetPath, 'utf-8');
  const merged = appendMissingLines(existing, template.toString('utf-8'));
  if (merged === existing) return 'kept';
  fs.writeFileSync(targetPath, merged);
  return 'appended';
}

const POLICY_APPLIERS: Readonly<Record<ProjectFilePolicy, (targetPath: string, template: Buffer) => ProjectFileAction>> = {
  [ProjectFilePolicy.Overwrite]: overwrite,
  [ProjectFilePolicy.CreateIfAbsent]: createIfAbsent,
  [ProjectFilePolicy.AppendMissingLines]: appendMissing,
};

function syncFile(worktreePath: string, frameworkRepoRoot: string, file: AdwPlaywrightProjectFile): ProjectFileOutcome {
  const template = fs.readFileSync(path.join(frameworkRepoRoot, ADW_PLAYWRIGHT_TEMPLATE_DIR, file.template));
  const action = POLICY_APPLIERS[file.policy](path.join(worktreePath, file.target), template);
  return { target: file.target, action };
}

/** A missing template throws: the caller decides what that means. */
export function syncAdwPlaywrightProject(worktreePath: string, frameworkRepoRoot: string): readonly ProjectFileOutcome[] {
  fs.mkdirSync(path.join(worktreePath, ADW_PLAYWRIGHT_PROJECT_DIR), { recursive: true });
  return ADW_PLAYWRIGHT_PROJECT_FILES.map(file => syncFile(worktreePath, frameworkRepoRoot, file));
}
