export interface FailingScenario {
  readonly name: string;
  readonly feature?: string;
}

export enum BaseScenarioOutcome {
  Passed = 'passed',
  Failed = 'failed',
  NotRun = 'not_run',
}

export type ScenarioRerun = (scenario: FailingScenario) => Promise<BaseScenarioOutcome>;

export interface TriagedScenario {
  readonly scenario: FailingScenario;
  readonly outcome: BaseScenarioOutcome;
}

export type RegressionTriage =
  | { readonly kind: 'waived' }
  | { readonly kind: 'introduced'; readonly triaged: readonly TriagedScenario[] }
  | { readonly kind: 'pre_existing'; readonly scenario: FailingScenario; readonly triaged: readonly TriagedScenario[] };

export interface RegressionTriageInput {
  readonly failing: readonly FailingScenario[];
  readonly waived: boolean;
  readonly rerunOnBase: ScenarioRerun;
}

const NAME_SEPARATOR = ' - ';

/**
 * Only a scenario seen failing on the base branch is pre-existing. One the base branch does not have, or cannot
 * run, was introduced by the change and goes to the fix agent as before. The first pre-existing scenario ends the
 * triage, since it parks the issue.
 */
export async function triageRegressionFailures(input: RegressionTriageInput): Promise<RegressionTriage> {
  if (input.waived) return { kind: 'waived' };

  const triaged: TriagedScenario[] = [];
  for (const scenario of input.failing) {
    const outcome = await input.rerunOnBase(scenario);
    triaged.push({ scenario, outcome });
    if (outcome === BaseScenarioOutcome.Failed) return { kind: 'pre_existing', scenario, triaged };
  }
  return { kind: 'introduced', triaged };
}

/**
 * cucumber-js names a JUnit case `<rule> - <scenario> - <examples> - #n.m: <example>`, with the rule and the
 * example parts present only for a scenario in a rule and for an outline example. The scenario name must be a
 * whole part of it, never a fragment of one.
 */
export function scenarioMatchesCase(scenarioName: string, caseName: string): boolean {
  return `${NAME_SEPARATOR}${caseName}${NAME_SEPARATOR}`.includes(`${NAME_SEPARATOR}${scenarioName}${NAME_SEPARATOR}`);
}

/** The new line carries the indentation, and the line ending, of the scenario line it goes above. */
export function withRerunTag(content: string, headerLine: number, tag: string): string {
  const lines = content.split('\n');
  const header = lines[headerLine - 1];
  if (header === undefined) return content;

  const indentation = header.match(/^[ \t]*/)?.[0] ?? '';
  const lineEnding = header.endsWith('\r') ? '\r' : '';
  return [...lines.slice(0, headerLine - 1), `${indentation}@${tag}${lineEnding}`, ...lines.slice(headerLine - 1)].join('\n');
}

export function describeFailingScenario({ name, feature }: FailingScenario): string {
  return feature === undefined ? name : `${feature}: ${name}`;
}
