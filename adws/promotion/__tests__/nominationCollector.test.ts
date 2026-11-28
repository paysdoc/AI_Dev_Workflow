import { describe, it, expect, vi } from 'vitest';
import type { FeatureFileSource } from '../../proof/featureScenarioIndex.ts';
import { collectNominations, NOMINATION_DECLINED_TAG, NOMINATION_TAG, NominationState, type Nomination } from '../nominationCollector.ts';

interface ScenarioFixture {
  readonly name: string;
  readonly tags: readonly string[];
}

const MERGED = new Date('2026-11-01T12:00:00Z');

function scenarioLines({ name, tags }: ScenarioFixture): string[] {
  const tagLine = tags.length > 0 ? [`  ${tags.join(' ')}`] : [];
  return [...tagLine, `  Scenario: ${name}`, '    Given a precondition', ''];
}

function featureText(scenarios: readonly ScenarioFixture[]): string {
  return ['Feature: Per-issue scenarios', '', ...scenarios.flatMap(scenarioLines)].join('\n');
}

function perIssueFile(issueNumber: number, scenarios: readonly ScenarioFixture[]): FeatureFileSource {
  return { path: `features/per-issue/feature-${issueNumber}.feature`, content: featureText(scenarios) };
}

/** A merge lookup that knows only the given issues as merged. */
function mergedOnly(merged: Readonly<Record<number, Date>>): (issueNumber: number) => Promise<Date | null> {
  return async (issueNumber) => merged[issueNumber] ?? null;
}

const namesOf = (nominations: readonly Nomination[]): string[] => nominations.map((nomination) => nomination.scenarioName);
const statesOf = (nominations: readonly Nomination[]): Record<string, NominationState> =>
  Object.fromEntries(nominations.map((nomination) => [nomination.scenarioName, nomination.state]));

describe('collectNominations', () => {
  it('returns a nominated scenario of a merged issue as awaiting a proposal, with its issue number, scenario name and file path', async () => {
    const nominations = await collectNominations({
      features: [perIssueFile(1201, [{ name: 'the cron trigger sweeps a stale per-issue file', tags: ['@adw-1201', '@boundary-subprocess', NOMINATION_TAG] }])],
      getMergedAt: mergedOnly({ 1201: MERGED }),
    });

    expect(nominations).toEqual([
      {
        issueNumber: 1201,
        scenarioName: 'the cron trigger sweeps a stale per-issue file',
        featurePath: 'features/per-issue/feature-1201.feature',
        state: NominationState.AwaitingProposal,
      },
    ]);
  });

  it('leaves out a nominated scenario whose issue has not merged', async () => {
    const nominations = await collectNominations({
      features: [perIssueFile(12, [{ name: 'nominated before the merge', tags: [NOMINATION_TAG] }])],
      getMergedAt: mergedOnly({}),
    });

    expect(nominations).toEqual([]);
  });

  it('returns a scenario carrying the declined tag as declined, with or without the nomination tag', async () => {
    const nominations = await collectNominations({
      features: [
        perIssueFile(12, [
          { name: 'declined in place of its nomination', tags: [NOMINATION_DECLINED_TAG] },
          { name: 'declined while still nominated', tags: [NOMINATION_TAG, NOMINATION_DECLINED_TAG] },
        ]),
      ],
      getMergedAt: mergedOnly({ 12: MERGED }),
    });

    expect(statesOf(nominations)).toEqual({
      'declined in place of its nomination': NominationState.Declined,
      'declined while still nominated': NominationState.Declined,
    });
  });

  it("leaves out the untagged scenarios of a merged issue's file", async () => {
    const nominations = await collectNominations({
      features: [
        perIssueFile(12, [
          { name: 'without tags', tags: [] },
          { name: 'nominated', tags: ['@adw-12', NOMINATION_TAG] },
          { name: 'with only its issue and boundary tags', tags: ['@adw-12', '@boundary-subprocess'] },
        ]),
      ],
      getMergedAt: mergedOnly({ 12: MERGED }),
    });

    expect(namesOf(nominations)).toEqual(['nominated']);
  });

  it('returns a nominated scenario the open proposal lists, by issue number and scenario name, as in an open proposal', async () => {
    const nominations = await collectNominations({
      features: [
        perIssueFile(12, [
          { name: 'listed in the proposal', tags: [NOMINATION_TAG] },
          { name: 'not listed in the proposal', tags: [NOMINATION_TAG] },
        ]),
      ],
      getMergedAt: mergedOnly({ 12: MERGED }),
      openProposalCandidates: [{ issueNumber: 12, scenarioName: 'listed in the proposal' }],
    });

    expect(statesOf(nominations)).toEqual({
      'listed in the proposal': NominationState.InOpenProposal,
      'not listed in the proposal': NominationState.AwaitingProposal,
    });
  });

  it('keeps a declined scenario declined when the open proposal lists it', async () => {
    const nominations = await collectNominations({
      features: [perIssueFile(12, [{ name: 'declined', tags: [NOMINATION_DECLINED_TAG] }])],
      getMergedAt: mergedOnly({ 12: MERGED }),
      openProposalCandidates: [{ issueNumber: 12, scenarioName: 'declined' }],
    });

    expect(statesOf(nominations)).toEqual({ declined: NominationState.Declined });
  });

  it('does not match an open-proposal candidate of the same scenario name under another issue number', async () => {
    const nominations = await collectNominations({
      features: [perIssueFile(12, [{ name: 'a shared scenario name', tags: [NOMINATION_TAG] }])],
      getMergedAt: mergedOnly({ 12: MERGED }),
      openProposalCandidates: [{ issueNumber: 13, scenarioName: 'a shared scenario name' }],
    });

    expect(statesOf(nominations)).toEqual({ 'a shared scenario name': NominationState.AwaitingProposal });
  });

  it("reads only the scenario's own tag lines: a nomination tag on the Feature line nominates nothing", async () => {
    const content = [
      `@adw-12 ${NOMINATION_TAG}`,
      'Feature: A feature tagged as a whole',
      '',
      '  @adw-12',
      '  Scenario: first scenario below the tagged Feature line',
      '    Given a precondition',
      '',
      '  Scenario: second scenario below the tagged Feature line',
      '    Given a precondition',
      '',
    ].join('\n');

    const nominations = await collectNominations({
      features: [{ path: 'features/per-issue/feature-12.feature', content }],
      getMergedAt: mergedOnly({ 12: MERGED }),
    });

    expect(nominations).toEqual([]);
  });

  it('compares tags whole: a tag that only begins with the nomination tag is no nomination', async () => {
    const nominations = await collectNominations({
      features: [perIssueFile(12, [{ name: 'tagged with longer tags', tags: [`${NOMINATION_TAG}-later`, `${NOMINATION_DECLINED_TAG}-maybe`] }])],
      getMergedAt: mergedOnly({ 12: MERGED }),
    });

    expect(nominations).toEqual([]);
  });

  it('treats a leftover @promotion-suggested-<date> tag as no nomination', async () => {
    const nominations = await collectNominations({
      features: [
        perIssueFile(12, [
          { name: 'suggested by the removed scorer', tags: ['@adw-12', '@promotion-suggested-2026-03-01'] },
          { name: 'declined under the removed scorer', tags: ['@adw-12', '@promotion-declined'] },
        ]),
      ],
      getMergedAt: mergedOnly({ 12: MERGED }),
    });

    expect(nominations).toEqual([]);
  });

  it('skips a file not named feature-<N>.feature and a file the Gherkin parser rejects', async () => {
    const nominated = featureText([{ name: 'nominated', tags: [NOMINATION_TAG] }]);

    const nominations = await collectNominations({
      features: [
        { path: 'features/per-issue/smoke.feature', content: nominated },
        { path: 'features/per-issue/feature-12-extra.feature', content: nominated },
        { path: 'features/per-issue/feature-13.feature', content: `this is not gherkin <<<BROKEN>>> ${NOMINATION_TAG}` },
        { path: 'features/per-issue/feature-14.feature', content: nominated },
      ],
      getMergedAt: async () => MERGED,
    });

    expect(nominations.map(({ issueNumber, featurePath }) => ({ issueNumber, featurePath }))).toEqual([
      { issueNumber: 14, featurePath: 'features/per-issue/feature-14.feature' },
    ]);
  });

  it('looks up the merge of each issue once, and only of issues whose file holds a nominated or declined scenario', async () => {
    const getMergedAt = vi.fn(mergedOnly({ 12: MERGED, 13: MERGED, 14: MERGED }));

    await collectNominations({
      features: [
        perIssueFile(12, [
          { name: 'nominated', tags: [NOMINATION_TAG] },
          { name: 'declined', tags: [NOMINATION_DECLINED_TAG] },
        ]),
        perIssueFile(13, [{ name: 'neither nominated nor declined', tags: ['@adw-13'] }]),
        perIssueFile(14, [{ name: 'declined', tags: [NOMINATION_DECLINED_TAG] }]),
      ],
      getMergedAt,
    });

    expect(getMergedAt).toHaveBeenCalledTimes(2);
    expect(getMergedAt).toHaveBeenCalledWith(12);
    expect(getMergedAt).toHaveBeenCalledWith(14);
    expect(getMergedAt).not.toHaveBeenCalledWith(13);
  });

  it("counts an issue whose merge lookup rejects as not merged, and still returns the other issues' nominations", async () => {
    const getMergedAt = (issueNumber: number): Promise<Date | null> =>
      issueNumber === 12 ? Promise.reject(new Error('forge timeout')) : Promise.resolve(MERGED);

    const nominations = await collectNominations({
      features: [
        perIssueFile(12, [{ name: 'its lookup rejects', tags: [NOMINATION_TAG] }]),
        perIssueFile(13, [{ name: 'its lookup answers', tags: [NOMINATION_TAG] }]),
      ],
      getMergedAt,
    });

    expect(namesOf(nominations)).toEqual(['its lookup answers']);
  });

  it('returns every nominated scenario of an issue that nominated more than one, in file order', async () => {
    const nominations = await collectNominations({
      features: [
        perIssueFile(12, [
          { name: 'second by name, first in the file', tags: [NOMINATION_TAG] },
          { name: 'not nominated', tags: ['@adw-12'] },
          { name: 'first by name, last in the file', tags: [NOMINATION_TAG] },
        ]),
      ],
      getMergedAt: mergedOnly({ 12: MERGED }),
    });

    expect(namesOf(nominations)).toEqual(['second by name, first in the file', 'first by name, last in the file']);
  });

  it('orders the nominations by issue number, then by their position in the file', async () => {
    const nominations = await collectNominations({
      features: [
        perIssueFile(1000, [{ name: 'issue 1000', tags: [NOMINATION_TAG] }]),
        perIssueFile(999, [
          { name: 'issue 999, upper', tags: [NOMINATION_TAG] },
          { name: 'issue 999, lower', tags: [NOMINATION_DECLINED_TAG] },
        ]),
      ],
      getMergedAt: mergedOnly({ 999: MERGED, 1000: MERGED }),
    });

    expect(nominations.map(({ issueNumber, scenarioName }) => [issueNumber, scenarioName])).toEqual([
      [999, 'issue 999, upper'],
      [999, 'issue 999, lower'],
      [1000, 'issue 1000'],
    ]);
  });

  it('finds a nominated scenario inside a Rule', async () => {
    const content = [
      'Feature: Per-issue scenarios',
      '',
      `  ${NOMINATION_TAG}`,
      '  Rule: a rule tagged as a whole',
      '',
      '    Scenario: inside the rule, without tags of its own',
      '      Given a precondition',
      '',
      `    @adw-12 ${NOMINATION_TAG}`,
      '    Scenario: inside the rule, nominated',
      '      Given a precondition',
      '',
    ].join('\n');

    const nominations = await collectNominations({
      features: [{ path: 'features/per-issue/feature-12.feature', content }],
      getMergedAt: mergedOnly({ 12: MERGED }),
    });

    expect(statesOf(nominations)).toEqual({ 'inside the rule, nominated': NominationState.AwaitingProposal });
  });
});
