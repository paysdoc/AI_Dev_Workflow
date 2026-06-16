import * as fs from 'fs';
import * as path from 'path';

// Map of Gherkin BDD framework names → step definition file extensions.
// Unknown or empty framework defaults to ['.ts'] to preserve existing cucumber-js/TS behaviour.
const FRAMEWORK_EXTENSION_MAP: Record<string, string[]> = {
  'cucumber-js': ['.ts', '.js'],
  'cucumber': ['.ts', '.js'],
  'behave': ['.py'],
  'pytest-bdd': ['.py'],
  'godog': ['.go'],
  'cucumber-rs': ['.rs'],
  'cucumber-ruby': ['.rb'],
};

export function stepDefExtensionsFor(bddFramework: string): string[] {
  const normalized = bddFramework.trim().toLowerCase();
  return FRAMEWORK_EXTENSION_MAP[normalized] ?? ['.ts'];
}

export function hasStepDefinitions(stepDefDir: string, extensions: string[], cwd: string): boolean {
  const resolved = path.resolve(cwd, stepDefDir);
  if (!fs.existsSync(resolved)) return false;

  const stack: string[] = [resolved];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push(path.join(current, entry.name));
      } else if (entry.isFile()) {
        if (extensions.some(ext => entry.name.endsWith(ext))) return true;
      }
    }
  }

  return false;
}
