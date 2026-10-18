/**
 * Then steps of the feature-1046 scenarios about what the proof says of platforms. The same lines are read from the proof the
 * assembler returned, or the scenario test phase wrote, and from the proof the review agent was given.
 */

import { Then, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import * as path from 'path';

import { harvestProofArtifacts } from '../../../adws/proof/proofArtifactHarvester.ts';

import { lastProofReceived } from './feature-994-evidence.ts';
import { artifactsDirectory } from './feature-994-layout.ts';
import { listOf } from './feature-994-scenarios.ts';
import { proofDocument } from './feature-994-world.ts';
import { coverageLineOf, coverageLinesIn, generatedAtIn, unattributedImagesIn } from './feature-1046-lines.ts';

function assertNoCoverageLine(document: string, whose: string): void {
  assert.deepStrictEqual(coverageLinesIn(document), [], `Expected ${whose} to have no platform coverage line.\n${document}`);
}

function assertCoverageLines(document: string, table: DataTable, whose: string): void {
  const expected = table.hashes().map(row => coverageLineOf({
    scenario: row['scenario'],
    present: listOf(row['present']).join(', '),
    missing: listOf(row['missing']).join(', '),
  }));
  assert.deepStrictEqual([...coverageLinesIn(document)].sort(), [...expected].sort(), `Expected ${whose} to have one platform coverage line for each of exactly ${JSON.stringify(expected)}.\n${document}`);
}

function assertUnattributed(document: string, table: DataTable, whose: string): void {
  const expected = table.hashes().map(row => row['image']);
  assert.deepStrictEqual([...unattributedImagesIn(document)].sort(), [...expected].sort(), `Expected ${whose} to list exactly ${JSON.stringify(expected)} as unattributed.\n${document}`);
}

const PLACEHOLDER = /<generated at>|<path of ([^>]+)>/g;

/** The absolute path of the image file the stand-in scenario runner wrote under that name. */
function pathOfImageNamed(name: string): string {
  const found = harvestProofArtifacts(artifactsDirectory()).filter(artifact => path.basename(artifact.absPath) === name);
  assert.strictEqual(found.length, 1, `Expected the artifacts directory to hold one image named "${name}", but it holds ${found.length}`);
  return found[0].absPath;
}

function filled(template: string, generatedAt: string): string {
  return template.replace(PLACEHOLDER, (_placeholder: string, name: string | undefined) => (name === undefined ? generatedAt : pathOfImageNamed(name)));
}

Then('the scenario proof has no platform coverage line', function () {
  assertNoCoverageLine(proofDocument(), 'the scenario proof');
});

Then(
  'the scenario proof has one platform coverage line for each of exactly these per-issue scenarios, naming the platforms present and the platforms missing:',
  function (table: DataTable) {
    assertCoverageLines(proofDocument(), table, 'the scenario proof');
  },
);

Then('the scenario proof lists exactly these images as unattributed:', function (table: DataTable) {
  assertUnattributed(proofDocument(), table, 'the scenario proof');
});

// The proof ends with a newline, which a doc string cannot hold.
Then('the scenario proof reads exactly as follows, each value in angle brackets standing for what it names:', function (text: string) {
  const document = proofDocument();
  assert.strictEqual(document, `${filled(text, generatedAtIn(document))}\n`, 'Expected the scenario proof to read exactly as the scenario says');
});

Then('the proof the review agent received has no platform coverage line', function () {
  assertNoCoverageLine(lastProofReceived().content, 'the proof the review agent received');
});

Then(
  'the proof the review agent received has one platform coverage line for each of exactly these per-issue scenarios, naming the platforms present and the platforms missing:',
  function (table: DataTable) {
    assertCoverageLines(lastProofReceived().content, table, 'the proof the review agent received');
  },
);

Then('the proof the review agent received lists exactly these images as unattributed:', function (table: DataTable) {
  assertUnattributed(lastProofReceived().content, table, 'the proof the review agent received');
});
