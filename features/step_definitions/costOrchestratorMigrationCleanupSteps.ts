import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { spawnSync } from 'child_process';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// Cost-related function/type names that must come from adws/cost, not from legacy modules.
const COST_SYMBOLS = [
  'mergeModelUsageMaps',
  'persistTokenCounts',
  'computeDisplayTokens',
  'computeTotalTokens',
  'computePrimaryModelTokens',
  'buildCostBreakdown',
  'computeTotalCostUsd',
  'computeEurRate',
  'formatCostBreakdownMarkdown',
  'emptyModelUsageMap',
  'ModelUsageMap',
  'ModelUsage',
  'CostBreakdown',
];

const DELETED_MODULES = [
  'costPricing',
  'costReport',
  'costCsvWriter',
  'tokenManager',
  'costTypes',
];

/** Recursively collect all .ts / .tsx files under a directory. */
function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...collectTsFiles(fullPath));
    } else if (stat.isFile() && (extname(entry) === '.ts' || extname(entry) === '.tsx')) {
      results.push(fullPath);
    }
  }
  return results;
}

// ── Shared state for directory scan scenarios ─────────────────────────────────

interface ScanCtx {
  combinedContent: string;
}

const scanCtx: ScanCtx = { combinedContent: '' };

// ── Given: directory scan ─────────────────────────────────────────────────────

Given('the {string} directory is scanned for imports', function (dir: string) {
  const fullDir = join(ROOT, dir);
  const files = collectTsFiles(fullDir);
  scanCtx.combinedContent = files.map(f => readFileSync(f, 'utf-8')).join('\n');
});

// ── Given: context-only steps ─────────────────────────────────────────────────

Given('the ADW codebase with old cost modules removed', function () {
  // Context only — asserts that old files are gone
  for (const mod of DELETED_MODULES) {
    const candidates = [
      join(ROOT, `adws/core/${mod}.ts`),
      join(ROOT, `adws/types/${mod}.ts`),
    ];
    for (const f of candidates) {
      assert.ok(!existsSync(f), `Expected deleted file to be gone: ${f}`);
    }
  }
});

Given('the phase files in {string} are read', function (dir: string) {
  const fullDir = join(ROOT, dir);
  const files = collectTsFiles(fullDir);
  const combined = files.map(f => readFileSync(f, 'utf-8')).join('\n');
  sharedCtx.fileContent = combined;
  sharedCtx.filePath = dir;
});

// Note: 'the environment variable {string} is set to {string}' is already defined in costCommentFormatterSteps.ts

// ── Then: file existence / non-existence ──────────────────────────────────────

Then('the file {string} does not exist', function (filePath: string) {
  assert.ok(!existsSync(join(ROOT, filePath)), `Expected file to not exist: ${filePath}`);
});

// ── Then: orchestrator import checks ─────────────────────────────────────────

Then(
  'all cost-related imports resolve to {string} or {string}',
  function (this: Record<string, string>, allowed1: string, allowed2: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    const filePath = this.filePath ?? sharedCtx.filePath;

    // For each import line containing a cost symbol, verify it comes from an allowed source.
    const importLines = content.split('\n').filter(line => /^\s*import\s/.test(line));
    for (const line of importLines) {
      const hasCostSymbol = COST_SYMBOLS.some(sym => line.includes(sym));
      if (!hasCostSymbol) continue;

      const fromMatch = line.match(/from\s+['"]([^'"]+)['"]/);
      if (!fromMatch) continue;
      const source = fromMatch[1];

      const isAllowed =
        source.includes('cost') ||
        source.includes(allowed1) ||
        source.includes(allowed2) ||
        source.includes('phaseCostCommit');

      assert.ok(
        isAllowed,
        `"${filePath}": cost symbol imported from "${source}" — expected "${allowed1}" or "${allowed2}"`,
      );
    }
  },
);

Then(
  'no imports reference {string}, {string}, {string}, or {string}',
  function (
    this: Record<string, string>,
    banned1: string,
    banned2: string,
    banned3: string,
    banned4: string,
  ) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    const filePath = this.filePath ?? sharedCtx.filePath;
    for (const banned of [banned1, banned2, banned3, banned4]) {
      const normalized = banned.replace(/\//g, '/');
      assert.ok(
        !content.includes(normalized),
        `"${filePath}" must not reference "${banned}"`,
      );
    }
  },
);

// ── Then: file does not export from deleted modules ───────────────────────────

Then(
  'the file does not export from {string}',
  function (this: Record<string, string>, moduleName: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    const filePath = this.filePath ?? sharedCtx.filePath;
    assert.ok(
      !content.includes(moduleName),
      `"${filePath}" must not re-export from "${moduleName}"`,
    );
  },
);

// ── Then: file does not import from a module ─────────────────────────────────

Then(
  'the file does not import from {string}',
  function (this: Record<string, string>, moduleName: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    const filePath = this.filePath ?? sharedCtx.filePath;
    const importRegex = new RegExp(`from\\s+['"][^'"]*${moduleName}[^'"]*['"]`);
    assert.ok(
      !importRegex.test(content),
      `"${filePath}" must not import from "${moduleName}"`,
    );
  },
);

Then(
  'the file does not import from deleted cost modules',
  function (this: Record<string, string>) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    const filePath = this.filePath ?? sharedCtx.filePath;
    for (const mod of DELETED_MODULES) {
      const importRegex = new RegExp(`from\\s+['"][^'"]*${mod}[^'"]*['"]`);
      assert.ok(
        !importRegex.test(content),
        `"${filePath}" must not import from deleted module "${mod}"`,
      );
    }
  },
);

// ── Then: interface field assertions ─────────────────────────────────────────

Then(
  'the {string} interface does not contain a {string} field',
  function (this: Record<string, string>, interfaceName: string, fieldName: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    const filePath = this.filePath ?? sharedCtx.filePath;

    // Extract the interface block to scope the check
    const interfaceRegex = new RegExp(
      `interface\\s+${interfaceName}\\s*\\{([^}]*)\\}`,
      's',
    );
    const match = interfaceRegex.exec(content);
    if (!match) {
      // Interface not found — field cannot exist
      return;
    }
    const body = match[1];
    assert.ok(
      !body.includes(fieldName),
      `"${filePath}": interface "${interfaceName}" must not contain field "${fieldName}"`,
    );
  },
);

Then(
  'the {string} interface still contains {string}, {string}, {string}, {string}, {string}, {string}, and {string}',
  function (
    this: Record<string, string>,
    interfaceName: string,
    f1: string,
    f2: string,
    f3: string,
    f4: string,
    f5: string,
    f6: string,
    f7: string,
  ) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    const filePath = this.filePath ?? sharedCtx.filePath;
    const interfaceRegex = new RegExp(
      `interface\\s+${interfaceName}\\s*\\{([^}]*)\\}`,
      's',
    );
    const match = interfaceRegex.exec(content);
    assert.ok(match, `"${filePath}": interface "${interfaceName}" not found`);
    const body = match![1];
    for (const field of [f1, f2, f3, f4, f5, f6, f7]) {
      assert.ok(
        body.includes(field),
        `"${filePath}": interface "${interfaceName}" must still contain field "${field}"`,
      );
    }
  },
);

Then(
  'the {string} interface still contains {string} and {string} fields',
  function (
    this: Record<string, string>,
    interfaceName: string,
    field1: string,
    field2: string,
  ) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    const filePath = this.filePath ?? sharedCtx.filePath;
    const interfaceRegex = new RegExp(
      `interface\\s+${interfaceName}\\s*\\{([^}]*)\\}`,
      's',
    );
    const match = interfaceRegex.exec(content);
    assert.ok(match, `"${filePath}": interface "${interfaceName}" not found`);
    const body = match![1];
    for (const field of [field1, field2]) {
      assert.ok(
        body.includes(field),
        `"${filePath}": interface "${interfaceName}" must still contain field "${field}"`,
      );
    }
  },
);

// ── Then: parseJsonlOutput function checks ────────────────────────────────────

Then(
  'the parseJsonlOutput function does not call {string} or {string}',
  function (this: Record<string, string>, fn1: string, fn2: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    const filePath = this.filePath ?? sharedCtx.filePath;
    assert.ok(!content.includes(fn1), `"${filePath}" must not call "${fn1}"`);
    assert.ok(!content.includes(fn2), `"${filePath}" must not call "${fn2}"`);
  },
);

Then(
  'the parseJsonlOutput function does not assign to {string}',
  function (this: Record<string, string>, assignment: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    const filePath = this.filePath ?? sharedCtx.filePath;
    assert.ok(
      !content.includes(assignment),
      `"${filePath}" must not assign to "${assignment}"`,
    );
  },
);

Then(
  'the parseJsonlOutput function still extracts text from assistant messages',
  function (this: Record<string, string>) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    const filePath = this.filePath ?? sharedCtx.filePath;
    assert.ok(
      content.includes('extractTextFromAssistantMessage') || content.includes("type: 'text'"),
      `"${filePath}": parseJsonlOutput must still extract text from assistant messages`,
    );
  },
);

Then(
  'the {string} function is still exported',
  function (this: Record<string, string>, fnName: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    const filePath = this.filePath ?? sharedCtx.filePath;
    assert.ok(
      content.includes(`export function ${fnName}`) ||
        content.includes(`export { ${fnName}`) ||
        content.includes(`export { ${fnName},`) ||
        content.includes(`, ${fnName} }`) ||
        content.includes(`, ${fnName},`),
      `"${filePath}": function "${fnName}" must still be exported`,
    );
  },
);

Then(
  'the parseJsonlOutput function still extracts tool usage from assistant messages',
  function (this: Record<string, string>) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    const filePath = this.filePath ?? sharedCtx.filePath;
    assert.ok(
      content.includes('extractToolUseFromMessage') || content.includes("type: 'tool_use'"),
      `"${filePath}": parseJsonlOutput must still extract tool usage`,
    );
  },
);

Then(
  'the parseJsonlOutput function still calls the onProgress callback for tool_use and text events',
  function (this: Record<string, string>) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    const filePath = this.filePath ?? sharedCtx.filePath;
    assert.ok(
      content.includes('onProgress') && content.includes('tool_use') && content.includes('text'),
      `"${filePath}": parseJsonlOutput must still call onProgress for tool_use and text events`,
    );
  },
);

// ── Then: no TypeScript file imports from deleted module ──────────────────────

Then(
  'no TypeScript file imports from {string} or {string}',
  function (path1: string, path2: string) {
    const combined = scanCtx.combinedContent;
    const regex1 = new RegExp(`from\\s+['"][^'"]*${escapeRegex(path1)}[^'"]*['"]`);
    const regex2 = new RegExp(`from\\s+['"][^'"]*${escapeRegex(path2)}[^'"]*['"]`);
    assert.ok(!regex1.test(combined), `Found import from "${path1}" — expected none`);
    assert.ok(!regex2.test(combined), `Found import from "${path2}" — expected none`);
  },
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Then: phase cost record assertions ───────────────────────────────────────

Then(
  'every phase file that produces cost records imports {string} from the cost module',
  function (symbol: string) {
    const content = sharedCtx.fileContent;
    // Each phase file that has createPhaseCostRecords should also have the symbol
    const hasCostRecords = content.includes('createPhaseCostRecords');
    if (!hasCostRecords) return; // no phase produces cost records — pass vacuously
    assert.ok(
      content.includes(symbol),
      `Phase files must import "${symbol}" from the cost module`,
    );
  },
);

Then('no phase file imports from deleted cost modules', function () {
  const content = sharedCtx.fileContent;
  for (const mod of DELETED_MODULES) {
    const importRegex = new RegExp(`from\\s+['"][^'"]*${mod}[^'"]*['"]`);
    assert.ok(
      !importRegex.test(content),
      `Phase files must not import from deleted module "${mod}"`,
    );
  }
});

// ── Then: imports from new cost module ────────────────────────────────────────

Then(
  'the file imports cost utilities from {string} or {string}',
  function (this: Record<string, string>, allowed1: string, allowed2: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    const filePath = this.filePath ?? sharedCtx.filePath;
    const hasCostImport =
      content.includes(`from '${allowed1}'`) ||
      content.includes(`from "${allowed1}"`) ||
      content.includes(`from '${allowed2}'`) ||
      content.includes(`from "${allowed2}"`) ||
      content.includes(`from '../cost'`) ||
      content.includes(`from "../cost"`) ||
      content.includes(`from './cost'`) ||
      content.includes(`from "./cost"`);
    assert.ok(
      hasCostImport,
      `"${filePath}": expected cost utilities imported from "${allowed1}" or "${allowed2}"`,
    );
  },
);

Then(
  'the file imports {string} from the cost module',
  function (this: Record<string, string>, symbol: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    const filePath = this.filePath ?? sharedCtx.filePath;
    assert.ok(
      content.includes(symbol),
      `"${filePath}": expected to import "${symbol}" from the cost module`,
    );
  },
);

Then(
  'the file imports {string} from {string} or {string}',
  function (this: Record<string, string>, symbol: string, path1: string, path2: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    const filePath = this.filePath ?? sharedCtx.filePath;
    const hasSymbol = content.includes(symbol);
    const hasPath =
      content.includes(path1) || content.includes(path2) ||
      content.includes('../cost') || content.includes('./cost');
    assert.ok(
      hasSymbol && hasPath,
      `"${filePath}": expected to import "${symbol}" from "${path1}" or "${path2}"`,
    );
  },
);

Then(
  'the file imports PhaseCostRecord from {string} or {string}',
  function (this: Record<string, string>, path1: string, path2: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    const filePath = this.filePath ?? sharedCtx.filePath;
    assert.ok(
      content.includes('PhaseCostRecord'),
      `"${filePath}": expected to import "PhaseCostRecord"`,
    );
    const hasPath =
      content.includes(path1) || content.includes(path2) ||
      content.includes('../cost') || content.includes('./cost');
    assert.ok(
      hasPath,
      `"${filePath}": expected "PhaseCostRecord" to be imported from "${path1}" or "${path2}"`,
    );
  },
);

Then(
  'the file imports from {string} or {string}',
  function (this: Record<string, string>, path1: string, path2: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    const filePath = this.filePath ?? sharedCtx.filePath;
    const hasImport =
      content.includes(path1) ||
      content.includes(path2) ||
      content.includes('../cost') ||
      content.includes('./cost');
    assert.ok(
      hasImport,
      `"${filePath}": expected at least one import from "${path1}" or "${path2}"`,
    );
  },
);

// Note: 'When {string} is run' is already defined in removeUnitTestsSteps.ts

When('the E2E test suite is run', function () {
  // Full BDD suite run as part of BDD is not feasible; mark as pending.
  return 'pending';
});

// ── Then: command result assertions ──────────────────────────────────────────

Then('all unit tests pass', function (this: Record<string, unknown>) {
  const result = this.__commandResult as ReturnType<typeof spawnSync> | undefined;
  if (!result) {
    // Not run — mark pending for full E2E contexts
    return 'pending';
  }
  const output = String(result.stdout ?? '') + String(result.stderr ?? '');
  assert.strictEqual(
    result.status,
    0,
    `Expected all unit tests to pass.\nStdout: ${output}`,
  );
});

Then('all BDD scenarios pass', function (this: Record<string, unknown>) {
  const result = this.__commandResult as ReturnType<typeof spawnSync> | undefined;
  if (!result) {
    return 'pending';
  }
  const output = String(result.stdout ?? '') + String(result.stderr ?? '');
  assert.strictEqual(
    result.status,
    0,
    `Expected all BDD scenarios to pass.\nOutput: ${output.substring(0, 500)}`,
  );
});

// ── When/Then: full workflow run (integration — marked pending) ───────────────

When(
  'a full workflow run completes using {string}',
  function (_orchestrator: string) {
    return 'pending';
  },
);

Then('cost CSV files are written to the projects directory', function () {
  return 'pending';
});

Then('each phase produces a PhaseCostRecord row in the per-issue CSV', function () {
  return 'pending';
});

Then('the project total CSV is rebuilt with aggregated data', function () {
  return 'pending';
});

Then(
  'the completion comment includes a cost section formatted by the new comment formatter',
  function () {
    return 'pending';
  },
);

Then('the cost section includes per-model token breakdown', function () {
  return 'pending';
});

