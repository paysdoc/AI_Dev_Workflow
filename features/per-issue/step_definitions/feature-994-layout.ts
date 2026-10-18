/**
 * Where a scenario run that a step stands for left its files, as the proof's shell lays them out: a JUnit report for each tag
 * beside the artifacts directory, which is the harvest root. No hooks and no steps: any step file may import it.
 */

import assert from 'assert';
import * as path from 'path';

import { s } from './feature-994-world.ts';

export function safeName(tag: string): string {
  return tag.replace(/^@/, '').replace(/[^A-Za-z0-9_-]/g, '-');
}

function requireProofDirectory(): string {
  assert.ok(s.proofDirectory, 'Expected the scenario to have said which scenario run it is about');
  return s.proofDirectory;
}

export function reportPathOf(tag: string): string {
  return path.join(requireProofDirectory(), `junit-${safeName(tag)}.xml`);
}

export function artifactsDirectory(): string {
  return path.join(requireProofDirectory(), 'artifacts');
}
