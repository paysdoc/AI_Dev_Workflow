import { describe, it, expect } from 'vitest';
import { ReviewIssueKind } from '../agents/reviewPromptArgs';
import { NO_PER_ISSUE_SCENARIOS, NO_SCENARIO_OPENED_A_PAGE } from '../proof/proofDocument';
import { EVIDENCE, SCENARIOS, prompt, section } from './reviewPrompt.helpers';

/**
 * `review.md` is a prompt, so it cannot import the issue kinds ADW passes it nor the lines of the scenario proof it quotes. These
 * tests compare its scenario checks with their sources, so that a drift fails here instead of showing as a reviewer that blocks
 * the wrong issues.
 */
describe('review.md judges the scenarios by the kind of issue', () => {
  const kindLines = (): string[] => section(SCENARIOS).split('\n').filter((line) => /^\s+- `/.test(line));
  const lineFor = (kind: string): string => kindLines().find((line) => line.split(':')[0].includes(`\`${kind}\``)) ?? '';

  it.each(Object.values(ReviewIssueKind))('names the issue kind %s', (kind) => {
    expect(prompt).toContain(`\`${kind}\``);
  });

  it.each([ReviewIssueKind.Feature, ReviewIssueKind.Bug])('makes missing per-issue scenarios a blocker for a %s only when the change alters behaviour at a Real Boundary', (kind) => {
    for (const phrase of ['`blocker`', 'Real Boundary', 'no finding']) expect(lineFor(kind)).toContain(phrase);
  });

  it.each([ReviewIssueKind.Chore, ReviewIssueKind.Promotion, ReviewIssueKind.PrReview])('makes missing per-issue scenarios no finding for a %s', (kind) => {
    expect(lineFor(kind)).toContain('no finding');
  });

  it('judges the zero-scenario claim when the proof says there are no per-issue scenarios', () => {
    expect(section(SCENARIOS)).toContain(`\`${NO_PER_ISSUE_SCENARIOS}\``);
    expect(section(SCENARIOS)).toMatch(/Judge the zero-scenario claim/);
    expect(section(SCENARIOS)).not.toMatch(/decide by `issueKind` alone/);
  });
});

describe('review.md blocks a missing scenario only for behaviour at a Real Boundary', () => {
  const BOUNDARIES = ['its real runtime', 'a real browser', 'the built artifact', 'a real command-line invocation', 'subprocess pattern'];

  it('says so in step 4, naming the Real Boundaries and leaving the variants, edge cases and error cases to unit tests', () => {
    const step = section(SCENARIOS);

    expect(step).toMatch(/missing scenario is a `blocker` only when the issue changes behaviour at a Real Boundary/);
    for (const phrase of [...BOUNDARIES, 'variants, edge cases and error cases']) expect(step).toContain(phrase);
  });

  it('asks for a scenario of every acceptance criterion observable at a Real Boundary, and no longer of every behaviour', () => {
    const step = section(SCENARIOS);

    expect(step).toMatch(/Every acceptance criterion of the issue that is observable at a Real Boundary/);
    expect(step).not.toContain('Every behaviour the issue asks for is exercised by a scenario');
  });

  it('no longer asks in the CLI guidance for a scenario of every change the issue asks for', () => {
    expect(section('### CLI applications')).not.toContain('a change it does ask for needs a scenario that observes it');
  });
});

describe('review.md has the reviewer check that each scenario drives the boundary it is tagged with', () => {
  it("Step 4 tells the reviewer to trace each scenario's step definitions into the support code, to the boundary its @boundary-<name> tag names", () => {
    const step = section(SCENARIOS);

    expect(step).toContain('`@boundary-<name>` tag');
    expect(step).toContain('`## Real Boundaries` in `.adw/scenarios.md`');
    expect(step).toMatch(/Trace the step definitions of each scenario into the support code they call/);
    expect(step).toContain('`@boundary-subprocess`');
    expect(step).toMatch(/does not drive its tagged boundary: a `blocker` that names the scenario, its tag and what the step code drives instead/);
  });
});

describe('review.md quotes the lines of the scenario proof that it judges', () => {
  it.each([NO_PER_ISSUE_SCENARIOS, NO_SCENARIO_OPENED_A_PAGE])('quotes "%s" verbatim', (line) => {
    expect(prompt).toContain(`\`${line}\``);
  });

  it('applies the no-page rule only to an issue that has per-issue scenarios, so that step 4 decides otherwise', () => {
    const evidence = section(EVIDENCE);

    expect(evidence).toContain(`\`${NO_SCENARIO_OPENED_A_PAGE}\``);
    expect(evidence).toContain(`does not say \`${NO_PER_ISSUE_SCENARIOS}\``);
  });
});
