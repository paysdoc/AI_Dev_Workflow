import * as fs from 'fs';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export interface TestCaseResult {
  name: string;
  classname?: string;
  status: 'passed' | 'failed' | 'skipped';
}

export interface TestReport {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  cases: TestCaseResult[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => name === 'testcase' || name === 'testsuite',
});

function classifyTestCase(tc: Record<string, unknown>): TestCaseResult['status'] {
  if ('failure' in tc || 'error' in tc) return 'failed';
  if ('skipped' in tc) return 'skipped';
  return 'passed';
}

function buildCase(tc: Record<string, unknown>): TestCaseResult {
  return {
    name: String(tc['@_name'] ?? ''),
    classname: tc['@_classname'] !== undefined ? String(tc['@_classname']) : undefined,
    status: classifyTestCase(tc),
  };
}

function collectSuites(parsed: Record<string, unknown>): unknown[] | null {
  const wrapper = (parsed as Record<string, unknown>)['testsuites'];
  if (wrapper !== undefined && wrapper !== null) {
    const suites = (wrapper as Record<string, unknown>)['testsuite'];
    if (Array.isArray(suites)) return suites;
  }
  const bare = parsed['testsuite'];
  if (Array.isArray(bare)) return bare;
  return null;
}

export function parseJUnitXml(xml: string): TestReport | null {
  if (!xml || !xml.trim()) return null;
  if (XMLValidator.validate(xml) !== true) return null;

  const parsed = parser.parse(xml) as Record<string, unknown>;
  const suites = collectSuites(parsed);
  if (suites === null) return null;

  const cases: TestCaseResult[] = [];
  for (const suite of suites) {
    const suiteObj = suite as Record<string, unknown>;
    const rawCases = suiteObj['testcase'];
    if (!rawCases) continue;
    const caseArray = Array.isArray(rawCases) ? rawCases : [rawCases];
    for (const tc of caseArray) {
      cases.push(buildCase(tc as Record<string, unknown>));
    }
  }

  const total = cases.length;
  const failed = cases.filter(c => c.status === 'failed').length;
  const skipped = cases.filter(c => c.status === 'skipped').length;
  const passed = total - failed - skipped;

  return { total, passed, failed, skipped, cases };
}

export function readJUnitReport(filePath: string): TestReport | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const xml = fs.readFileSync(filePath, 'utf-8');
    return parseJUnitXml(xml);
  } catch {
    return null;
  }
}
