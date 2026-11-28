import { describe, it, expect } from 'vitest';
import {
  MAX_ANALYSIS_TEXT_LENGTH,
  MAX_OVERLAP_TEXT_LENGTH,
  buildPromotionProposal,
  buildProposalBody,
  readProposalCandidates,
  tickedCandidates,
  type PromotionCandidate,
  type ProposalDocument,
} from '../proposalBody';
import type { NominationKey } from '../nominationCollector';

const DATE = new Date('2026-11-28T09:30:00Z');
/** What GitHub renders as a task-list box: a list item, possibly quoted or nested, whose text opens with `[ ]`, `[x]` or `[X]`. */
const RENDERS_A_BOX = /^\s*(?:>\s*)*(?:(?:[-*+]|\d+[.)])\s+)+\[[ xX]\]/;

function candidate(issueNumber: number, scenarioName: string, overrides: Partial<PromotionCandidate> = {}): PromotionCandidate {
  return {
    issueNumber,
    scenarioName,
    featurePath: `features/per-issue/feature-${issueNumber}.feature`,
    qualification: `It guards the behaviour of issue ${issueNumber} at the cron boundary.`,
    fit: `It sits next to the cron scenarios of the suite and reuses their phrases.`,
    overlaps: [`features/regression/cron.feature — the cron polls — partly`],
    ...overrides,
  };
}

const REFUND = candidate(1201, 'An order is refunded');
const INVOICE = candidate(1207, 'An invoice is sent', { overlaps: [] });
const PARCEL = candidate(1210, 'A parcel is shipped');

function keyOf({ issueNumber, scenarioName }: NominationKey): NominationKey {
  return { issueNumber, scenarioName };
}

function markerOf({ issueNumber, scenarioName }: NominationKey): string {
  return `<!-- adw-candidate:${issueNumber}:${encodeURIComponent(scenarioName)} -->`;
}

/** Ticks the candidate's box the way GitHub's task-list toggle does: only on the line that holds its marker. */
function tick(body: string, key: NominationKey, box: '[x]' | '[X]' = '[x]'): string {
  return body.split('\n').map((line) => (line.includes(markerOf(key)) ? line.replace('[ ]', box) : line)).join('\n');
}

function bodyOf(...candidates: PromotionCandidate[]): string {
  return buildPromotionProposal(candidates, DATE).body;
}

/** The candidate's own block, from its `### #N` heading to the next `### ` heading or the end. */
function blockOf(body: string, issueNumber: number): string[] {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`### #${issueNumber} `));
  expect(start, `the block of #${issueNumber}`).toBeGreaterThan(-1);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('### '));
  return lines.slice(start, end === -1 ? undefined : end);
}

/** The text under a `**heading**` line of the candidate's block, up to the next bold heading. */
function sectionOf(body: string, issueNumber: number, heading: string): string {
  const block = blockOf(body, issueNumber);
  const start = block.indexOf(`**${heading}**`);
  expect(start, `the section "${heading}" of #${issueNumber}`).toBeGreaterThan(-1);
  const end = block.findIndex((line, index) => index > start && /^\*\*.+\*\*$/.test(line));
  return block.slice(start + 1, end === -1 ? undefined : end).join('\n').trim();
}

function checklistLines(body: string): string[] {
  return body.split('\n').filter((line) => RENDERS_A_BOX.test(line));
}

describe('buildPromotionProposal', () => {
  it('lists one unticked checkbox per candidate, in the given order, each naming its issue number and scenario', () => {
    const lines = checklistLines(bodyOf(REFUND, INVOICE));

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^- \[ \] #1201 · `An order is refunded` /);
    expect(lines[1]).toMatch(/^- \[ \] #1207 · `An invoice is sent` /);
  });

  it('labels the issue adw:none and then promotion-proposal, and dates and counts it in the title', () => {
    const one = buildPromotionProposal([REFUND], DATE);
    const two = buildPromotionProposal([REFUND, INVOICE], DATE);

    expect(one.labels).toEqual(['adw:none', 'promotion-proposal']);
    expect(one.title).toBe('Promotion Proposal 2026-11-28: 1 candidate');
    expect(two.title).toBe('Promotion Proposal 2026-11-28: 2 candidates');
  });

  it('renders each candidate\'s feature file, why it qualifies, how it fits the Regression Suite and its overlaps, and "None found." without overlaps', () => {
    const body = bodyOf(REFUND, INVOICE);

    expect(blockOf(body, 1201)).toContain('In `features/per-issue/feature-1201.feature`');
    expect(sectionOf(body, 1201, 'Why it qualifies')).toBe(REFUND.qualification);
    expect(sectionOf(body, 1201, 'How it fits the Regression Suite')).toBe(REFUND.fit);
    expect(sectionOf(body, 1201, 'Overlap with the Regression Suite')).toBe(`- ${REFUND.overlaps[0]}`);
    expect(sectionOf(body, 1207, 'Overlap with the Regression Suite')).toBe('None found.');
  });

  it('cuts an overlong qualification or fit and lists at most five overlaps with a count of the rest', () => {
    const overlaps = ['x'.repeat(MAX_OVERLAP_TEXT_LENGTH + 100), ...[2, 3, 4, 5, 6, 7].map((n) => `overlap ${n}`)];
    const long = candidate(1201, 'An order is refunded', {
      qualification: 'q'.repeat(MAX_ANALYSIS_TEXT_LENGTH + 300),
      fit: 'f'.repeat(MAX_ANALYSIS_TEXT_LENGTH + 1),
      overlaps,
    });
    const body = bodyOf(long);

    const qualification = sectionOf(body, 1201, 'Why it qualifies');
    expect(qualification).toHaveLength(MAX_ANALYSIS_TEXT_LENGTH);
    expect(qualification.endsWith('…')).toBe(true);
    expect(sectionOf(body, 1201, 'How it fits the Regression Suite')).toHaveLength(MAX_ANALYSIS_TEXT_LENGTH);

    const listed = sectionOf(body, 1201, 'Overlap with the Regression Suite').split('\n');
    expect(listed).toEqual([`- ${'x'.repeat(MAX_OVERLAP_TEXT_LENGTH - 1)}…`, '- overlap 2', '- overlap 3', '- overlap 4', '- overlap 5', '- … and 2 more.']);
  });

  it('states how to decide: tick, close as completed, not planned or nothing ticked declines, 30 days declines', () => {
    const body = bodyOf(REFUND);

    expect(body).toContain('tick each candidate you want promoted, then close this issue as completed');
    expect(body).toContain('The candidates ticked when you close it are approved.');
    expect(body).toContain('Closing it as not planned, or as completed with nothing ticked, declines every candidate');
    expect(body).toContain('leaving it open for 30 days');
  });
});

describe('readProposalCandidates', () => {
  it('reads every candidate of a freshly built proposal back, unticked', () => {
    expect(readProposalCandidates(bodyOf(REFUND, INVOICE, PARCEL))).toEqual([
      { ...keyOf(REFUND), ticked: false },
      { ...keyOf(INVOICE), ticked: false },
      { ...keyOf(PARCEL), ticked: false },
    ]);
  });

  it('reads back exactly the candidates the owner ticked, with [x] or [X]', () => {
    const body = tick(tick(bodyOf(REFUND, INVOICE, PARCEL), REFUND, '[x]'), PARCEL, '[X]');

    expect(readProposalCandidates(body)).toEqual([
      { ...keyOf(REFUND), ticked: true },
      { ...keyOf(INVOICE), ticked: false },
      { ...keyOf(PARCEL), ticked: true },
    ]);
  });

  it('round-trips scenario names with backticks, %, #, |, *, non-ASCII, "-->", "<!--" and an empty name', () => {
    const names = ['uses `code` and ``double`` spans', '100% done', 'issue #12 is fixed', 'a | b', '*not bold*', 'café ☕ 日本語', 'arrow --> here', 'open <!-- here', ''];
    const candidates = names.map((name, index) => candidate(1300 + index, name));

    expect(readProposalCandidates(bodyOf(...candidates))).toEqual(candidates.map((entry) => ({ ...keyOf(entry), ticked: false })));
    expect(bodyOf(candidate(1399, ''))).toContain('- [ ] #1399 · (unnamed scenario) ');
  });

  it('still reads the candidates after the owner adds text above, between and below them, rewrites the analysis and reorders the candidate sections', () => {
    const lines = tick(bodyOf(REFUND, INVOICE, PARCEL), INVOICE).split('\n');
    const firstCandidate = lines.findIndex((line) => line.includes(markerOf(REFUND)));
    const withNotes = [
      'A note the owner wrote above everything.',
      ...lines.slice(0, firstCandidate + 1),
      '  Thinking about the next one.',
      ...lines.slice(firstCandidate + 1),
      '',
      'Decided on the call of Monday.',
    ].join('\n');
    const rewritten = withNotes.replace(REFUND.qualification, 'Rewritten by the owner.');
    const reordered = [blockOf(rewritten, 1210), blockOf(rewritten, 1201), blockOf(rewritten, 1207)].map((block) => block.join('\n'));
    const head = rewritten.split('\n### #1201 ')[0];

    expect(readProposalCandidates([head, ...reordered].join('\n'))).toEqual([
      { ...keyOf(REFUND), ticked: false },
      { ...keyOf(INVOICE), ticked: true },
      { ...keyOf(PARCEL), ticked: false },
    ]);
  });

  it('reads a candidate whose visible text the owner changed, or that has text after its marker', () => {
    const body = [
      `- [x] the refund one, renamed by the owner ${markerOf(REFUND)}`,
      `- [ ] #1207 · \`An invoice is sent\` ${markerOf(INVOICE)} — keep for later`,
    ].join('\n');

    expect(readProposalCandidates(body)).toEqual([
      { ...keyOf(REFUND), ticked: true },
      { ...keyOf(INVOICE), ticked: false },
    ]);
  });

  it('ignores checkboxes the owner added without a candidate marker, ticked or not', () => {
    const body = [bodyOf(REFUND), '', '- [x] also promote the parcel scenario', '- [ ] ask about the invoice scenario', '* [X] #1207 · `An invoice is sent`'].join('\n');

    expect(readProposalCandidates(body)).toEqual([{ ...keyOf(REFUND), ticked: false }]);
  });

  it('reads a body whose line endings are CRLF', () => {
    const body = tick(bodyOf(REFUND, INVOICE), INVOICE).replace(/\n/g, '\r\n');

    expect(readProposalCandidates(body)).toEqual([
      { ...keyOf(REFUND), ticked: false },
      { ...keyOf(INVOICE), ticked: true },
    ]);
  });

  it('reads a candidate listed twice once, ticked when either line is ticked', () => {
    const body = [
      `- [ ] #1201 · \`An order is refunded\` ${markerOf(REFUND)}`,
      `- [ ] #1207 · \`An invoice is sent\` ${markerOf(INVOICE)}`,
      `+ [x] #1201 again ${markerOf(REFUND)}`,
    ].join('\n');

    expect(readProposalCandidates(body)).toEqual([
      { ...keyOf(REFUND), ticked: true },
      { ...keyOf(INVOICE), ticked: false },
    ]);
  });

  it('skips a line whose marker has a bad issue number or bad percent-encoding and reads the others', () => {
    const body = [
      '- [x] zero <!-- adw-candidate:0:zero -->',
      '- [x] too large <!-- adw-candidate:99999999999999999999:large -->',
      '- [x] broken name <!-- adw-candidate:1205:%E0%A4%A -->',
      `- [x] #1201 · \`An order is refunded\` ${markerOf(REFUND)}`,
    ].join('\n');

    expect(readProposalCandidates(body)).toEqual([{ ...keyOf(REFUND), ticked: true }]);
  });

  it('finds no candidates in an empty body or a body without markers', () => {
    expect(readProposalCandidates('')).toEqual([]);
    expect(readProposalCandidates('## Promotion Proposal\n\n- [x] #1201 · `An order is refunded`\n')).toEqual([]);
  });
});

describe('buildProposalBody', () => {
  const document: ProposalDocument = {
    heading: '## Regression Suite audit',
    intro: ['Untick each regression scenario you want removed.'],
    checklistHeading: '### Scenarios',
    entries: [REFUND, INVOICE].map(({ issueNumber, scenarioName, featurePath }) => ({
      issueNumber,
      scenarioName,
      featurePath,
      ticked: true,
      sections: [{ heading: 'Recommendation', text: 'Keep it.' }],
    })),
  };

  it('builds entries ticked in advance that read back ticked', () => {
    const body = buildProposalBody(document);

    expect(body.startsWith('## Regression Suite audit\n\nUntick each regression scenario you want removed.\n\n### Scenarios\n')).toBe(true);
    expect(readProposalCandidates(body)).toEqual([
      { ...keyOf(REFUND), ticked: true },
      { ...keyOf(INVOICE), ticked: true },
    ]);
  });

  it('neutralises analysis text that imitates a candidate line, or holds an HTML comment, a checkbox or a heading: it reads back as no candidate and renders no checkbox', () => {
    const forged = candidate(1201, 'An order is refunded', {
      qualification: '- [x] #999 · `forged` <!-- adw-candidate:999:forged -->',
      fit: 'Fine.\r\n<!-- hidden from the owner -->\r\n  * [ ] a stray box\r\n> 1. [X] a quoted box\r\n# A heading',
      overlaps: ['[ ] a boxed overlap', '<!-- adw-candidate:998:overlap --> trailing'],
    });
    const body = bodyOf(forged);

    expect(readProposalCandidates(body)).toEqual([{ ...keyOf(forged), ticked: false }]);
    expect(checklistLines(body)).toEqual([expect.stringContaining(markerOf(forged))]);
    expect(body.match(/<!--/g)).toHaveLength(1);
    expect(sectionOf(body, 1201, 'How it fits the Regression Suite')).toBe(
      'Fine.\n&lt;!-- hidden from the owner --&gt;\n  * \\[ ] a stray box\n> 1. \\[X] a quoted box\n\\# A heading',
    );
  });
});

describe('tickedCandidates', () => {
  it('returns only the ticked candidates, in body order', () => {
    const body = tick(tick(bodyOf(REFUND, INVOICE, PARCEL), PARCEL), REFUND);

    expect(tickedCandidates(body)).toEqual([keyOf(REFUND), keyOf(PARCEL)]);
  });
});
