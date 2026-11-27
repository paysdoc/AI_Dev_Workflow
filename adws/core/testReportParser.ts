import * as fs from 'fs';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export interface TestCaseResult {
  name: string;
  classname?: string;
  status: 'passed' | 'failed' | 'skipped';
  /**
   * True when the case carries a bare `<failure/>`/`<error/>`, which is how cucumber reports an UNDEFINED or PENDING
   * scenario. The case keeps `status: 'skipped'`, so unit-test counts and verdicts do not change.
   */
  incomplete: boolean;
  /** Message from `<failure message="…">` or text body; undefined for passed/skipped cases. */
  failureMessage?: string;
  /** Paths from the case's `[[ATTACHMENT|<path>]]` lines in `<system-out>`, as written: relative to the report's directory. */
  attachments: string[];
}

export interface TestReport {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  /** The `incomplete` cases, which `skipped` counts as well. */
  incomplete: number;
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

/** A `<failure>` or `<error>` child whose marker is bare. A genuine `<skipped/>` is not incomplete. */
function isIncompleteCase(tc: Record<string, unknown>): boolean {
  const hasFailure = 'failure' in tc;
  if (!hasFailure && !('error' in tc)) return false;
  return isEmptyFailureMarker(hasFailure ? tc['failure'] : tc['error']);
}

function classifyTestCase(tc: Record<string, unknown>): TestCaseResult['status'] {
  // Cucumber's junit formatter emits a bare <failure/> for PENDING/UNDEFINED
  // scenarios (no exception payload). Such a case is counted as skipped, which
  // keeps parseCucumberSummary's "pending is not a failure" counts, but flagged
  // as incomplete, so that a run the runner failed for it can still fail.
  if (isIncompleteCase(tc)) return 'skipped';
  if ('failure' in tc || 'error' in tc) return 'failed';
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

const ATTACHMENT_LINE = /\[\[ATTACHMENT\|([^\]]+)\]\]/g;

/** One `<system-out>` is a string (CDATA is merged into the text) or an object with `#text`; a repeated element is an array of them. */
function textOfNode(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node === null || typeof node !== 'object') return '';
  return String((node as Record<string, unknown>)['#text'] ?? '');
}

function systemOutText(tc: Record<string, unknown>): string {
  const systemOut = tc['system-out'];
  const nodes = Array.isArray(systemOut) ? systemOut : [systemOut];
  return nodes.map(textOfNode).join('\n');
}

function extractAttachments(tc: Record<string, unknown>): string[] {
  return [...systemOutText(tc).matchAll(ATTACHMENT_LINE)].map(match => match[1]);
}

function buildCase(tc: Record<string, unknown>): TestCaseResult {
  const status = classifyTestCase(tc);
  return {
    name: String(tc['@_name'] ?? ''),
    classname: tc['@_classname'] !== undefined ? String(tc['@_classname']) : undefined,
    status,
    incomplete: isIncompleteCase(tc),
    failureMessage: status === 'failed' ? extractFailureMessage(tc) : undefined,
    attachments: extractAttachments(tc),
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
  const incomplete = cases.filter(c => c.incomplete).length;
  const passed = total - failed - skipped;

  return { total, passed, failed, skipped, incomplete, cases };
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
