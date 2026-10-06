/**
 * Reads a JUnit report as Playwright's `junit` reporter writes it, and as the stand-in `npx` does: one `<testcase>` per
 * scenario, whose `<system-out>` lists each attachment as `[[ATTACHMENT|<path>]]`, relative to the directory of the report.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { ScenarioProofResult } from '../../../adws/phases/scenarioProof.ts';

export type CaseStatus = 'passed' | 'failed' | 'skipped';

export interface JunitCase {
  readonly name: string;
  readonly status: CaseStatus;
  /** Absolute paths of every attachment the case lists. */
  readonly attachments: readonly string[];
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const TESTCASE = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
const ATTACHMENT = /\[\[ATTACHMENT\|([^\]]*)\]\]/g;

function decodeEntities(text: string): string {
  return text.replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function statusOf(body: string): CaseStatus {
  if (/<(failure|error)\b/.test(body)) return 'failed';
  return /<skipped\b/.test(body) ? 'skipped' : 'passed';
}

function parseCase(attributes: string, body: string, reportDirectory: string): JunitCase {
  const name = /\bname="([^"]*)"/.exec(attributes)?.[1] ?? '';
  const attachments = [...body.matchAll(ATTACHMENT)].map(match => path.resolve(reportDirectory, match[1]));
  return { name: decodeEntities(name), status: statusOf(body), attachments };
}

export function readJunitCases(reportPath: string): JunitCase[] {
  const xml = fs.readFileSync(reportPath, 'utf-8');
  return [...xml.matchAll(TESTCASE)].map(match => parseCase(match[1], match[2] ?? '', path.dirname(reportPath)));
}

/** Playwright names a case "<feature> › <scenario>", so a scenario is named by what follows the last separator. */
export function caseForScenario(cases: readonly JunitCase[], scenario: string): JunitCase | undefined {
  return cases.find(({ name }) => name === scenario || name.endsWith(` › ${scenario}`));
}

export function imagesOf(junitCase: JunitCase): string[] {
  return junitCase.attachments.filter(file => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()));
}

export function isInside(file: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(file));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** The path the scenario proof gives a tag's run for its JUnit report: beside the proof's own file, outside its artifacts directory. */
export function reportPathFor(proof: ScenarioProofResult, tag: string): string {
  const safeName = tag.replace(/^@/, '').replace(/[^A-Za-z0-9_-]/g, '-');
  return path.resolve(path.dirname(proof.resultsFilePath), `junit-${safeName}.xml`);
}
