/**
 * Then steps of the feature-1046 scenarios about the images the proof assembler selected. An image is the file the stand-in
 * scenario runner wrote when its bytes are those the runner gives the file of that name (feature-994-runner.ts).
 */

import { Then, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import type { PerIssueImage } from '../../../adws/proof/types.ts';

import { artifactsDirectory } from './feature-994-layout.ts';
import { imageBytes } from './feature-994-runner.ts';
import { s } from './feature-994-world.ts';

interface Selection {
  readonly image: string;
  readonly scenario: string;
  readonly platform: string;
}

function selectionOf({ relPath, scenario, platform }: PerIssueImage): Selection {
  return { image: relPath, scenario, platform: platform ?? 'no platform' };
}

function byImage(first: Selection, second: Selection): number {
  return first.image.localeCompare(second.image);
}

function assertIsFileTheRunnerWrote(image: PerIssueImage): void {
  const name = path.basename(image.relPath);
  assert.ok(image.absPath.startsWith(`${artifactsDirectory()}${path.sep}`), `Expected "${image.relPath}" to lie in the artifacts directory, but its path is ${image.absPath}`);
  assert.ok(fs.readFileSync(image.absPath).equals(imageBytes(name)), `Expected "${image.absPath}" to be the file the scenario runner wrote as "${name}"`);
}

function selectedImages(): readonly PerIssueImage[] {
  assert.ok(s.assembled, 'Expected the proof assembler to have assembled a proof first');
  return s.assembled.perIssueImages;
}

Then('the proof assembler selects exactly these images, each for the scenario and the platform named:', function (table: DataTable) {
  const selected = selectedImages();
  const expected = table.hashes().map(row => ({ image: row['image'], scenario: row['scenario'], platform: row['platform'] }));

  assert.deepStrictEqual(selected.map(selectionOf).sort(byImage), expected.sort(byImage), `Expected the proof assembler to select exactly ${JSON.stringify(expected)}, but it selected ${JSON.stringify(selected.map(selectionOf))}`);
  selected.forEach(assertIsFileTheRunnerWrote);
});

Then('the proof assembler selects no image', function () {
  assert.deepStrictEqual(selectedImages().map(selectionOf), [], 'Expected the proof assembler to select no image');
});
