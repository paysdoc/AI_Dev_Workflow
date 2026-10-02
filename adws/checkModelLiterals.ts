/**
 * Every model comes from `adws/core/modelRouting.ts`. Three shapes at a call site name a model
 * literally and are findings:
 *  - an argument list in which `--model` is followed by a string literal;
 *  - the `model` argument of `runClaudeAgentWithCommand`;
 *  - a `model` parameter with a string-literal default.
 *
 * Scans `adws/` and `scripts/` under the working directory; test code is out of scope. Source is
 * read, never imported, so the scan can run over any tree.
 *
 * Run via: bun run lint:model-literals
 * Exits 0 if no call site names a model, 1 otherwise.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const SCANNED_DIRS: readonly string[] = ['adws', 'scripts'];
const SKIPPED_NAMES: ReadonlySet<string> = new Set(['__tests__', 'node_modules', 'dist']);
const ROUTING_MODULE = 'adws/core/modelRouting.ts';
const MODEL_FLAG = '--model';
const SPAWN_FUNCTION = 'runClaudeAgentWithCommand';
const SPAWN_MODEL_ARGUMENT_INDEX = 4;

function isLiteral(node: ts.Node | undefined): node is ts.StringLiteralLike {
  return node !== undefined && ts.isStringLiteralLike(node);
}

function literalAfterModelFlag(elements: ts.NodeArray<ts.Expression>): ts.Node[] {
  return elements.flatMap((element, index) => {
    const next = elements[index + 1];
    return isLiteral(element) && element.text === MODEL_FLAG && isLiteral(next) ? [next] : [];
  });
}

function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function literalSpawnModel(call: ts.CallExpression): ts.Node[] {
  const model = call.arguments[SPAWN_MODEL_ARGUMENT_INDEX];
  return calleeName(call.expression) === SPAWN_FUNCTION && isLiteral(model) ? [model] : [];
}

function literalModelDefault(parameter: ts.ParameterDeclaration): ts.Node[] {
  const { name, initializer } = parameter;
  return ts.isIdentifier(name) && name.text === 'model' && isLiteral(initializer) ? [initializer] : [];
}

function literalModelsAt(node: ts.Node): ts.Node[] {
  if (ts.isArrayLiteralExpression(node)) return literalAfterModelFlag(node.elements);
  if (ts.isCallExpression(node)) return literalSpawnModel(node);
  if (ts.isParameter(node)) return literalModelDefault(node);
  return [];
}

/** `file:line` of every literal model named at a call site in one source file. */
export function findLiteralModelCallSites(fileName: string, sourceText: string): string[] {
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const findings: string[] = [];

  const visit = (node: ts.Node): void => {
    for (const literal of literalModelsAt(node)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(literal.getStart(sourceFile));
      findings.push(`${fileName}:${line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return findings;
}

function isSourceFile(name: string): boolean {
  return /\.tsx?$/.test(name) && !/\.d\.ts$/.test(name) && !/\.test\.tsx?$/.test(name);
}

function listSourceFiles(root: string, relDir: string): string[] {
  const absoluteDir = path.join(root, relDir);
  if (!fs.existsSync(absoluteDir)) return [];

  return fs.readdirSync(absoluteDir, { withFileTypes: true })
    .filter((entry) => !SKIPPED_NAMES.has(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const relPath = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) return listSourceFiles(root, relPath);
      return isSourceFile(entry.name) ? [relPath] : [];
    });
}

/** Findings for every source file under `<root>/adws` and `<root>/scripts`, with paths relative to `root`. */
export function scanForLiteralModels(root: string): string[] {
  return SCANNED_DIRS
    .flatMap((dir) => listSourceFiles(root, dir))
    .filter((relPath) => relPath !== ROUTING_MODULE)
    .flatMap((relPath) => findLiteralModelCallSites(relPath, fs.readFileSync(path.join(root, relPath), 'utf-8')));
}

function main(): void {
  const findings = scanForLiteralModels(process.cwd());

  if (findings.length === 0) {
    console.log('Model-literal check passed: no call site outside the routing module names a model.');
    return;
  }

  console.error(`Model-literal check failed: ${findings.length} call site(s) name a model literally. Read the model from adws/core/modelRouting.ts instead.`);
  findings.forEach((finding) => console.error(finding));
  process.exit(1);
}

if (process.argv[1]?.includes('checkModelLiterals')) main();
