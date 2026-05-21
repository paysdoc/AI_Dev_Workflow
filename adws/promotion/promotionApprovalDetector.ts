import { parse } from './scenarioParser.ts';
import type { ApprovedScenario } from './types.ts';

export function detectApprovals(content: string): ApprovedScenario[] {
  const scenarios = parse(content);
  return scenarios
    .filter(s => s.tags.some(t => t === '@promotion'))
    .map(s => ({
      headerLine: s.headerLine,
      startLine: s.startLine,
      endLine: s.endLine,
      scenarioName: s.name,
    }));
}
