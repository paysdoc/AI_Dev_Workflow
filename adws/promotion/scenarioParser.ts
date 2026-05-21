import { Parser, AstBuilder, GherkinClassicTokenMatcher } from '@cucumber/gherkin';
import type { GherkinDocument, Scenario as GherkinScenario, Step as GherkinStep, Tag } from '@cucumber/messages';
import { IdGenerator } from '@cucumber/messages';
import type { Scenario, Step } from './types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildParser(): Parser<any> {
  const idFn = IdGenerator.uuid();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder = new AstBuilder(idFn) as any;
  const matcher = new GherkinClassicTokenMatcher();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Parser<any>(builder, matcher);
}

function mapStep(s: GherkinStep): Step {
  return {
    keyword: (s.keyword ?? '').trim(),
    text: s.text ?? '',
    line: s.location?.line ?? 0,
  };
}

function mapScenario(scenario: GherkinScenario): Scenario {
  const tags = (scenario.tags as readonly Tag[]).map((t: Tag) => t.name);
  const steps = (scenario.steps as readonly GherkinStep[]).map(mapStep);

  const firstTagLine =
    scenario.tags && scenario.tags.length > 0
      ? (scenario.tags[0].location?.line ?? scenario.location?.line ?? 0)
      : (scenario.location?.line ?? 0);

  const headerLine = scenario.location?.line ?? 0;
  const startLine = firstTagLine;
  const endLine = steps.length > 0 ? steps[steps.length - 1].line : headerLine;

  return { tags, steps, startLine, endLine, headerLine };
}

export function parse(content: string, _fileUri?: string): Scenario[] {
  const parser = buildParser();
  const document = parser.parse(content) as GherkinDocument;
  const feature = document.feature;
  if (!feature) return [];

  return (feature.children ?? [])
    .filter(child => child.scenario != null)
    .map(child => mapScenario(child.scenario!));
}
