import { describe, it, expect } from 'vitest';
import { bodyLinksIssue } from '../../forge/issueLinkMarker';
import type { NominationKey } from '../nominationCollector';
import { DeclineReason } from '../promotionDecider';
import { PROPOSAL_DECISION_MARKER, buildDecisionComment, hasDecisionRecord, readDecisionRecord, type DecisionCommentInput, type DecisionOutcome } from '../proposalDecisionRecord';

const REFUND: NominationKey = { issueNumber: 1201, scenarioName: 'An order is refunded' };
const INVOICE: NominationKey = { issueNumber: 1207, scenarioName: 'An invoice is sent' };
const PARCEL: NominationKey = { issueNumber: 1210, scenarioName: 'A parcel is shipped' };
const IMPLEMENTATION_ISSUE = 1500;

const APPROVED: DecisionCommentInput = { outcome: 'approved', approved: [REFUND], declined: [INVOICE], missing: [PARCEL], implementationIssue: IMPLEMENTATION_ISSUE };
const NOT_PLANNED: DecisionCommentInput = { outcome: 'declined', reason: DeclineReason.NotPlanned, approved: [], declined: [REFUND, INVOICE], missing: [], implementationIssue: null };
const NOTHING_TICKED: DecisionCommentInput = { outcome: 'declined', reason: DeclineReason.NothingTicked, approved: [], declined: [REFUND, INVOICE], missing: [], implementationIssue: null };
const EXPIRED: DecisionCommentInput = { outcome: 'expired', reason: DeclineReason.Expired, approved: [], declined: [PARCEL], missing: [], implementationIssue: null };

describe('buildDecisionComment and readDecisionRecord — the round trip', () => {
  const cases: ReadonlyArray<readonly [DecisionOutcome, DecisionCommentInput]> = [
    ['approved', APPROVED],
    ['declined', NOT_PLANNED],
    ['expired', EXPIRED],
  ];

  it.each(cases)('the comment built for the outcome %s reads back that outcome', (outcome, input) => {
    expect(readDecisionRecord([buildDecisionComment(input)])).toBe(outcome);
  });
});

describe('readDecisionRecord', () => {
  it('returns null for comments without the marker', () => {
    const comments = ['Looks good to me.', `${PROPOSAL_DECISION_MARKER}:approved`, '<!-- adw-candidate:1201:An%20order%20is%20refunded -->'];

    expect(readDecisionRecord([])).toBeNull();
    expect(readDecisionRecord(comments)).toBeNull();
    expect(hasDecisionRecord(comments)).toBe(false);
  });

  it('finds a marker in the third of three comments', () => {
    const comments = ['First thoughts.', 'Ticked two of them.', `Done.\n\n<!-- ${PROPOSAL_DECISION_MARKER}:expired -->`];

    expect(readDecisionRecord(comments)).toBe('expired');
    expect(hasDecisionRecord(comments)).toBe(true);
  });

  it('reads a marker with an unknown outcome as declined', () => {
    expect(readDecisionRecord([`<!-- ${PROPOSAL_DECISION_MARKER}:withdrawn -->`])).toBe('declined');
  });
});

describe('buildDecisionComment — what it tells the owner', () => {
  it('names the implementation issue and every approved, declined and missing candidate by issue and scenario name', () => {
    const comment = buildDecisionComment(APPROVED);

    expect(comment).toContain(`#${IMPLEMENTATION_ISSUE}`);
    expect(comment).toContain('#1201 · `An order is refunded`');
    expect(comment).toContain('#1207 · `An invoice is sent`');
    expect(comment).toContain('#1210 · `A parcel is shipped`');
  });

  it.each([
    ['closed as not planned', NOT_PLANNED, 'closed as not planned'],
    ['closed as completed with nothing ticked', NOTHING_TICKED, 'closed as completed with nothing ticked'],
    ['open for 30 days', EXPIRED, 'open for 30 days without a decision'],
  ] as const)('states its reason when the proposal was %s', (_case, input, reason) => {
    expect(buildDecisionComment(input)).toContain(reason);
  });

  it('links none of the issues it names with Closes or Implements', () => {
    const comments = [APPROVED, NOT_PLANNED, NOTHING_TICKED, EXPIRED].map(buildDecisionComment);
    const linked = comments.flatMap((comment) => [REFUND, INVOICE, PARCEL].map((key) => key.issueNumber).concat(IMPLEMENTATION_ISSUE).filter((issue) => bodyLinksIssue(comment, issue)));

    expect(linked).toEqual([]);
  });

  it('shows a scenario name holding <!--, --> or backticks escaped, in a code span, and adds no marker of its own', () => {
    const name = `A \`tricky\` <!-- ${PROPOSAL_DECISION_MARKER}:approved --> name`;
    const comment = buildDecisionComment({ ...NOT_PLANNED, declined: [{ issueNumber: 1220, scenarioName: name }] });

    expect(comment).toContain(`#1220 · \`\` A \`tricky\` &lt;!-- ${PROPOSAL_DECISION_MARKER}:approved --&gt; name \`\``);
    expect(comment.match(/<!--/g)).toHaveLength(1);
    expect(readDecisionRecord([comment])).toBe('declined');
  });
});
