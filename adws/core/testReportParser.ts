import * as fs from 'fs';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export interface TestCaseResult {
  name: string;
  classname?: string;
  status: 'passed' | 'failed' | 'skipped';
  /** Message from `<failure message="…">` or text body; undefined for passed/skipped cases. */
  failureMessage?: string;
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
  // JUnit reports come from our own test runner, not untrusted input.
  // Raise entity-expansion limits so large suites (> 1000 testcases with
  // entities like &gt; / &amp; in names or <system-out>) never trip the
  // fast-xml-parser billion-laughs guard and get silently swallowed to null.
  processEntities: {
    maxEntityCount: Infinity,
    maxTotalExpansions: Infinity,
  },
});

/**
 * A `<failure>`/`<error>` child with no attributes and no text content — e.g.
 * cucumber's bare `<failure/>`, emitted for PENDING and UNDEFINED scenarios
 * (which carry no exception/message). `fast-xml-parser` represents that as an
 * empty string; a genuine failure parses to an object (attributes/`#text`) or a
 * non-empty string (e.g. an AMBIGUOUS message or a stack-trace body).
 */
function isEmptyFailureMarker(marker: unknown): boolean {
  if (marker === '' || marker === null || marker === undefined) return true;
  if (typeof marker === 'object') return Object.keys(marker as Record<string, unknown>).length === 0;
  return false;
}

function classifyTestCase(tc: Record<string, unknown>): TestCaseResult['status'] {
  const hasFailure = 'failure' in tc;
  if (hasFailure || 'error' in tc) {
    const marker = hasFailure ? tc['failure'] : tc['error'];
    // Cucumber's junit formatter emits a bare <failure/> for PENDING/UNDEFINED
    // scenarios (no exception payload). Restore parseCucumberSummary's
    // "pending is not a failure" semantics: bare marker → skipped, not failed.
    return isEmptyFailureMarker(marker) ? 'skipped' : 'failed';
  }
  if ('skipped' in tc) return 'skipped';
  return 'passed';
}

function extractFailureMessage(tc: Record<string, unknown>): string | undefined {
  const child = ('failure' in tc ? tc['failure'] : tc['error']) as Record<string, unknown> | string | undefined;
  if (!child) return undefined;
  // Text-only failure (no attributes): fast-xml-parser returns a string
  if (typeof child === 'string') return child.trim() || undefined;
  if (typeof child !== 'object') return undefined;
  const msg = child['@_message'];
  if (msg !== undefined) return String(msg);
  const text = child['#text'];
  if (text !== undefined && String(text).trim()) return String(text).trim();
  return undefined;
}

function buildCase(tc: Record<string, unknown>): TestCaseResult {
  const status = classifyTestCase(tc);
  return {
    name: String(tc['@_name'] ?? ''),
    classname: tc['@_classname'] !== undefined ? String(tc['@_classname']) : undefined,
    status,
    failureMessage: status === 'failed' ? extractFailureMessage(tc) : undefined,
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
  } catch (err) {
    // Surface parse errors so callers can distinguish "report absent" from
    // "report present but failed to parse".  Both return null; only the
    // latter logs — the fs.existsSync guard handles the absent case above.
    console.error(`[testReportParser] Failed to parse JUnit report at ${filePath}: ${err}`);
    return null;
  }
}
