import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readStepDefinitionSources } from '../stepDefinitionSources';

const KOTLIN_AND_JAVA = ['.kt', '.java'];

let root: string;

function write(relativePath: string, text: string): void {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-step-sources-'));
  write('scenarios/src/test/kotlin/steps/OrderSteps.kt', 'class OrderSteps');
  write('scenarios/src/test/kotlin/steps/deep/InvoiceSteps.java', 'class InvoiceSteps {}');
  write('scenarios/src/test/kotlin/steps/README.md', '# steps');
  write('features/per-issue/step_definitions/feature-12.kt', 'class Feature12Steps');
  write('app/src/main/kotlin/App.kt', 'class App');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('readStepDefinitionSources', () => {
  it('reads every source with one of the extensions under each directory, recursively, with repository-relative / paths, sorted', () => {
    const sources = readStepDefinitionSources(root, ['scenarios/src/test/kotlin', 'features/per-issue/step_definitions'], KOTLIN_AND_JAVA);

    expect(sources).toEqual([
      { file: 'features/per-issue/step_definitions/feature-12.kt', text: 'class Feature12Steps' },
      { file: 'scenarios/src/test/kotlin/steps/OrderSteps.kt', text: 'class OrderSteps' },
      { file: 'scenarios/src/test/kotlin/steps/deep/InvoiceSteps.java', text: 'class InvoiceSteps {}' },
    ]);
  });

  it('skips a directory that does not exist, reads a file under two overlapping directories once, and reads nothing for no extensions', () => {
    const directories = ['scenarios/src/test/kotlin', 'scenarios/src/test/kotlin/steps', 'scenarios/src/test/missing'];

    expect(readStepDefinitionSources(root, directories, ['.kt']).map((source) => source.file)).toEqual(['scenarios/src/test/kotlin/steps/OrderSteps.kt']);
    expect(readStepDefinitionSources(root, directories, [])).toEqual([]);
    expect(readStepDefinitionSources(path.join(root, 'no-such-worktree'), directories, KOTLIN_AND_JAVA)).toEqual([]);
  });
});
