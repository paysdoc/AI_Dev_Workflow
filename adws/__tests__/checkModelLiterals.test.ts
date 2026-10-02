import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findLiteralModelCallSites, scanForLiteralModels } from '../checkModelLiterals';
import { REPO_ROOT } from '../core/environment';

const LITERAL_SHAPES = [
  "spawnSync(p, ['--model', 'haiku']);",
  "runClaudeAgentWithCommand('/x', [], 'a', 'o', 'sonnet');",
  "function f(model = 'opus') {}",
].join('\n');

const ROUTED_SHAPES = [
  "spawnSync(p, ['--model', PROBE_MODEL]);",
  "runClaudeAgentWithCommand('/x', [], 'a', 'o', getModelForCommand('/x'));",
  "function f(model = getModelForCommand('/x')) {}",
  'function g(model: string) {}',
].join('\n');

describe('findLiteralModelCallSites', () => {
  it('reports each shape that names a model literally, by line', () => {
    expect(findLiteralModelCallSites('probe.ts', LITERAL_SHAPES)).toEqual(['probe.ts:1', 'probe.ts:2', 'probe.ts:3']);
  });

  it('reports none when the model comes from the routing module', () => {
    expect(findLiteralModelCallSites('probe.ts', ROUTED_SHAPES)).toEqual([]);
  });

  it('reports a typed model parameter with a literal default', () => {
    expect(findLiteralModelCallSites('spawn.ts', "export function spawn(model: string = 'sonnet'): void {}")).toEqual(['spawn.ts:1']);
  });

  it('reads TSX files', () => {
    const source = "export const App = () => <div>{run(['--model', 'haiku'])}</div>;";

    expect(findLiteralModelCallSites('app.tsx', source)).toEqual(['app.tsx:1']);
  });

  it('ignores model names that start no process', () => {
    const source = [
      "type ModelName = 'sonnet' | 'opus' | 'haiku';",
      "const label = 'sonnet';",
      "// spawnSync(p, ['--model', 'haiku']);",
      "runClaudeAgentWithCommand('/x', [], 'a', 'o');",
      "spawnSync(p, ['--effort', 'high']);",
    ].join('\n');

    expect(findLiteralModelCallSites('names.ts', source)).toEqual([]);
  });
});

describe('scanForLiteralModels', () => {
  const roots: string[] = [];

  function makeTree(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'model-literals-'));
    roots.push(root);
    for (const [relPath, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, relPath)), { recursive: true });
      fs.writeFileSync(path.join(root, relPath), content);
    }
    return root;
  }

  afterEach(() => {
    roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
  });

  it('finds no call site in the repository that names a model literally', () => {
    const findings = scanForLiteralModels(REPO_ROOT);

    expect(findings, `Call sites naming a model literally:\n${findings.join('\n')}`).toEqual([]);
  });

  it('scans adws/ and scripts/ and reports paths relative to the root', () => {
    const root = makeTree({
      'adws/agents/spawn.ts': "run(['--model', 'haiku']);",
      'scripts/probe.ts': "run(['--model', 'sonnet']);",
      'features/steps.ts': "run(['--model', 'opus']);",
    });

    expect(scanForLiteralModels(root)).toEqual(['adws/agents/spawn.ts:1', 'scripts/probe.ts:1']);
  });

  it('skips tests, the routing module, node_modules and dist', () => {
    const literal = "run(['--model', 'haiku']);";
    const root = makeTree({
      'adws/__tests__/spawn.test.ts': literal,
      'adws/agents/spawn.test.ts': literal,
      'adws/core/modelRouting.ts': literal,
      'adws/node_modules/pkg/index.ts': literal,
      'adws/dist/spawn.ts': literal,
    });

    expect(scanForLiteralModels(root)).toEqual([]);
  });

  it('passes over a root with no adws/ or scripts/ directory', () => {
    expect(scanForLiteralModels(makeTree({ 'README.md': '# nothing to scan' }))).toEqual([]);
  });
});
