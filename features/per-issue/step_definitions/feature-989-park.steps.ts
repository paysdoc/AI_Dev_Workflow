/**
 * Park-comment scenarios of feature-989. Each calls the pure builder directly: a scenario's table of
 * evidence becomes a `ParkEvidence`, with sample values for the fields the table leaves out (a check's
 * command and exit code). Each directive assertion reads what the comment says the directive does and
 * compares it with the scenario's words, or with `DIRECTIVE_MEANINGS` where the scenario leaves them out.
 */

import { Given, When, Then, Before, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';

import { Platform } from '../../../adws/core/applicationType.ts';
import { HostTool } from '../../../adws/core/deviceCommands.ts';
import type { DeviceFailure } from '../../../adws/core/deviceLifecycle.ts';
import { FixLoopStall } from '../../../adws/core/staticCheckFixLoop.ts';
import { isActionableComment, isCancelComment, isRetryComment } from '../../../adws/core/workflowCommentParsing.ts';
import { ParkReason, buildParkComment, type ParkEvidence, type ParkedCheck } from '../../../adws/forge/parkComment.ts';

import { assertDirectiveSays, directiveMeaning } from '../../regression/step_definitions/feature-989-comments.ts';

const ADW_ID = 'bdd989-park-comment';

/**
 * Written from the decision records, not read from the builder, so that a builder that gives a directive another
 * meaning fails: a pre-existing regression takes a red baseline's meanings (ADR-0060), a stalled fix loop gives only
 * `## Retry` a meaning (ADR-0059), and ADW never assumes an application type (ADR-0061).
 */
const DIRECTIVE_MEANINGS: Readonly<Partial<Record<ParkReason, Readonly<Record<string, string>>>>> = {
  [ParkReason.PreExistingRegression]: {
    '## Retry': 're-runs the scenario on the base branch and parks the issue again if it still fails there',
  },
  [ParkReason.FixLoopStalled]: {
    '## Continue': 'waives nothing for this park: use `## Retry` to continue the fix loop',
  },
  [ParkReason.MissingApplicationType]: {
    '## Retry': 're-reads `## Application Type` after `adw_init` has been re-run',
    '## Continue': 'waives nothing, because ADW never assumes an application type',
  },
};

interface ParkScenario {
  evidence: ParkEvidence | null;
  comment: string | null;
  /** The comment of each reason, for the scenario that builds one for every reason. */
  comments: Map<string, string>;
}

const park: ParkScenario = { evidence: null, comment: null, comments: new Map() };

/** Safe to call twice: a scenario that carries the tags of two features runs the hooks of both. */
export function resetParkScenario(): void {
  Object.assign(park, { evidence: null, comment: null, comments: new Map() });
}

Before({ tags: '@adw-989' }, resetParkScenario);

function isParkReason(value: string): value is ParkReason {
  return (Object.values(ParkReason) as string[]).includes(value);
}

function sampleCheck(check: string, output: string): ParkedCheck {
  return { check, command: `run the ${check}`, exitCode: 1, output };
}

function enumValue<Value extends string>(values: Readonly<Record<string, Value>>, what: string, name: string): Value {
  const found = Object.values(values).find(candidate => candidate === name);
  return found ?? assert.fail(`Unknown ${what} "${name}"`);
}

/** A device that did not boot, or a host tool that is missing when the table names one. */
function deviceFailureFor(facts: Readonly<Record<string, string>>): DeviceFailure {
  const platform = enumValue(Platform, 'platform', facts['platform'] ?? Platform.Android);
  const output = facts['output'] ?? 'sample device output';
  if (facts['tool'] !== undefined) return { kind: 'tool_missing', platform, tool: enumValue(HostTool, 'host tool', facts['tool']), output };
  return { kind: 'boot_failed', platform, attempts: Number(facts['attempts'] ?? 3), output };
}

function evidenceFor(reason: ParkReason, facts: Readonly<Record<string, string>>): ParkEvidence {
  const baseBranch = facts['base branch'] ?? 'trunk';
  switch (reason) {
    case ParkReason.BaselineRed:
      return { reason, baseBranch, failedChecks: [sampleCheck(facts['failing check'] ?? 'lint', facts['output'] ?? 'sample output')] };
    case ParkReason.PreExistingRegression:
      return { reason, baseBranch, scenario: facts['failing scenario'] ?? 'A sample scenario' };
    case ParkReason.FixLoopStalled:
      return {
        reason,
        failedChecks: [sampleCheck(facts['failing check'] ?? 'lint', facts['output'] ?? 'sample output')],
        stall: FixLoopStall.IdenticalOutput,
        rounds: 2,
        rejections: [],
      };
    case ParkReason.MissingApplicationType:
      return { reason, found: facts['application type'] ?? null };
    case ParkReason.BaseServerDown:
      return { reason, baseBranch, output: facts['server output'] ?? 'sample server output' };
    case ParkReason.DeviceBootFailed:
      return { reason, failure: deviceFailureFor(facts) };
    default:
      return assert.fail(`Unknown park reason: ${String(reason)}`);
  }
}

function requireEvidence(): ParkEvidence {
  assert.ok(park.evidence, 'Expected a park to have been described first');
  return park.evidence;
}

function requireComment(): string {
  assert.ok(park.comment, 'Expected the park comment to have been built first');
  return park.comment;
}

Given('a park for the reason {string} whose evidence is:', function (reason: string, table: DataTable) {
  assert.ok(isParkReason(reason), `Unknown park reason "${reason}"`);
  park.evidence = evidenceFor(reason, table.rowsHash());
});

When('the park comment is built', function () {
  park.comment = buildParkComment(ADW_ID, requireEvidence());
});

When('a park comment is built, with sample evidence, for each of these reasons:', function (table: DataTable) {
  table.hashes().forEach((row) => {
    assert.ok(isParkReason(row.reason), `Unknown park reason "${row.reason}"`);
    park.comments.set(row.reason, buildParkComment(ADW_ID, evidenceFor(row.reason, {})));
  });
});

Then('the park comment names {string}', function (name: string) {
  const comment = requireComment();
  assert.ok(comment.includes(name), `Expected the park comment to name "${name}", got:\n${comment}`);
});

Then('the park comment quotes {string}', function (quoted: string) {
  const comment = requireComment();
  const quotingLine = comment.split('\n').find(line => line.startsWith('    ') && line.includes(quoted));
  assert.ok(quotingLine, `Expected the park comment to quote "${quoted}" in an indented line, got:\n${comment}`);
});

Then('the park comment says that it fails on the base branch {string}', function (baseBranch: string) {
  const comment = requireComment();
  const line = comment.split('\n').find(candidate => candidate.includes('fails on the base branch') && candidate.includes(baseBranch));
  assert.ok(line, `Expected the park comment to say that it fails on the base branch "${baseBranch}", got:\n${comment}`);
});

Then('the park comment says to re-run {string}', function (command: string) {
  const comment = requireComment();
  assert.ok(comment.toLowerCase().includes(`re-run \`${command}\``), `Expected the park comment to say to re-run ${command}, got:\n${comment}`);
});

Then('the park comment says that {string} continues the static-check fix loop', function (directive: string) {
  assertDirectiveSays(requireComment(), directive, 'continues the static-check fix loop');
});

Then('the park comment says that {string} re-runs the baseline and parks the issue again if it is still red', function (directive: string) {
  assertDirectiveSays(requireComment(), directive, 're-runs the baseline and parks the issue again if it is still red');
});

Then('the park comment says that {string} waives the baseline, so that this run fixes the pre-existing failures too', function (directive: string) {
  assertDirectiveSays(requireComment(), directive, 'waives the baseline, so that this run fixes the pre-existing failures too');
});

Then('the park comment says that {string} lets this run fix the pre-existing failure too', function (directive: string) {
  assertDirectiveSays(requireComment(), directive, 'lets this run fix the pre-existing failure too');
});

Then('the park comment says what {string} does for this park', function (directive: string) {
  const { reason } = requireEvidence();
  const expected = DIRECTIVE_MEANINGS[reason]?.[directive];
  assert.ok(expected, `DIRECTIVE_MEANINGS holds no meaning of ${directive} for a ${reason} park`);
  const meaning = directiveMeaning(requireComment(), directive);
  assert.ok(meaning.includes(expected), `Expected the park comment to say that ${directive} ${expected}, but it says that ${directive} ${meaning}`);
});

Then('each of those park comments mentions {string} and {string}', function (first: string, second: string) {
  assert.ok(park.comments.size > 0, 'Expected park comments to have been built first');
  park.comments.forEach((comment, reason) => {
    assert.ok(comment.includes(first) && comment.includes(second), `Expected the ${reason} park comment to mention "${first}" and "${second}", got:\n${comment}`);
  });
});

function assertNoDirective(comment: string, which: string): void {
  assert.ok(!isRetryComment(comment), `Expected ADW to take ${which} for no "## Retry" directive`);
  assert.ok(!isActionableComment(comment), `Expected ADW to take ${which} for no "## Continue" directive`);
  assert.ok(!isCancelComment(comment), `Expected ADW to take ${which} for no "## Cancel" directive`);
}

function assertTheThreeDirectives(retry: string, continues: string, cancel: string): void {
  assert.deepStrictEqual([retry, continues, cancel], ['## Retry', '## Continue', '## Cancel'], 'The directives this step checks are the three ADW acts on');
}

Then('ADW would take none of them, as the latest comment on an issue, for a {string}, {string} or {string} directive', function (retry: string, continues: string, cancel: string) {
  assertTheThreeDirectives(retry, continues, cancel);
  park.comments.forEach((comment, reason) => assertNoDirective(comment, `the ${reason} park comment`));
});

Then('ADW would take the park comment, as the latest comment on an issue, for no {string}, {string} or {string} directive', function (retry: string, continues: string, cancel: string) {
  assertTheThreeDirectives(retry, continues, cancel);
  assertNoDirective(requireComment(), 'the park comment');
});
