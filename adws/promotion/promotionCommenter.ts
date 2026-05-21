import { parse as parseVocabulary } from './vocabularyParser.ts';
import { parse as parseScenarios } from './scenarioParser.ts';
import { score } from './promotionScorer.ts';
import { computeThreshold } from './promotionThreshold.ts';
import { applyTagState, detectExistingSuggestionDate } from './promotionTagWriter.ts';
import type { TagState } from './types.ts';

const PER_ISSUE_RE = /^features\/per-issue\/feature-\d+\.feature$/;

export interface PromotionCommenterDeps {
  loadVocabulary: () => string;
  fetchChangedFiles: (prNumber: number) => Promise<{ path: string; status: string }[]>;
  readFile: (path: string) => string;
  writeFile: (path: string, content: string) => void;
  postComment: (prNumber: number, body: string) => Promise<void>;
  today: () => string;
  log?: (msg: string, level?: string) => void;
  applyHitlLabel: (issueNumber: number) => Promise<void>;
}

export interface SuggestedScenario {
  file: string;
  scenarioHeaderLine: number;
  score: number;
}

export interface PromotionResult {
  suggestedScenarios: SuggestedScenario[];
  hitlLabelApplied?: boolean;
}

// Decision matrix:
// | Existing tag | Score ≥ N | Action            | Comment? |
// | none         | yes       | add-suggestion    | yes      |
// | none         | no        | no-op             | no       |
// | dated today  | yes       | no-op (suppress)  | no       |
// | dated today  | no        | remove-suggestion | no       |
// | dated earlier| yes       | refresh-date      | yes      |
// | dated earlier| no        | remove-suggestion | no       |
function decideTagAction(
  existingDate: string | null,
  today: string,
  scoreMeetsThreshold: boolean,
): { tagAction: TagState | 'no-op'; commentEligible: boolean } {
  if (existingDate === null) {
    return scoreMeetsThreshold
      ? { tagAction: 'add-suggestion', commentEligible: true }
      : { tagAction: 'no-op', commentEligible: false };
  }
  if (existingDate === today) {
    return scoreMeetsThreshold
      ? { tagAction: 'no-op', commentEligible: false }
      : { tagAction: 'remove-suggestion', commentEligible: false };
  }
  return scoreMeetsThreshold
    ? { tagAction: 'refresh-date', commentEligible: true }
    : { tagAction: 'remove-suggestion', commentEligible: false };
}

function formatPromotionComment(suggested: SuggestedScenario[]): string {
  const lines = ['## Promotion Suggestions', ''];
  for (const s of suggested) {
    lines.push(`- \`${s.file}\` line ${s.scenarioHeaderLine} (score: ${s.score}) — @promotion-suggested-`);
  }
  lines.push('');
  lines.push('These scenarios scored above the promotion threshold. Consider promoting them to `features/regression/`.');
  return lines.join('\n');
}

export async function runPromotionCommenter(
  prNumber: number,
  issueNumber: number,
  deps: PromotionCommenterDeps,
): Promise<PromotionResult> {
  const logger = deps.log ?? (() => void 0);
  const today = deps.today();
  const registry = parseVocabulary(deps.loadVocabulary());
  const threshold = computeThreshold({ promotedCount90d: 0, totalPerIssueCount90d: 0 });
  const changedFiles = await deps.fetchChangedFiles(prNumber);
  const suggestedScenarios: SuggestedScenario[] = [];

  for (const file of changedFiles) {
    if (!PER_ISSUE_RE.test(file.path)) continue;
    if (file.status === 'removed') continue;

    let content: string;
    try {
      content = deps.readFile(file.path);
    } catch (err) {
      logger(`promotionCommenter: failed to read ${file.path}: ${err}`, 'warn');
      continue;
    }

    let scenarios;
    try {
      scenarios = parseScenarios(content, file.path);
    } catch (err) {
      logger(`promotionCommenter: failed to parse ${file.path}: ${err} — skipping`, 'warn');
      continue;
    }

    for (const scenario of scenarios) {
      const result = score(scenario, registry, registry.surfaceExamples);
      const existingDate = detectExistingSuggestionDate(content, scenario.headerLine);
      const { tagAction, commentEligible } = decideTagAction(
        existingDate,
        today,
        result.total >= threshold,
      );

      if (tagAction !== 'no-op') {
        const updated = applyTagState(content, scenario.headerLine, tagAction, today);
        deps.writeFile(file.path, updated);
        content = updated;
      }

      if (commentEligible) {
        suggestedScenarios.push({
          file: file.path,
          scenarioHeaderLine: scenario.headerLine,
          score: result.total,
        });
      }
    }
  }

  let hitlLabelApplied = false;
  if (suggestedScenarios.length > 0) {
    await deps.postComment(prNumber, formatPromotionComment(suggestedScenarios));
    try {
      await deps.applyHitlLabel(issueNumber);
      hitlLabelApplied = true;
    } catch (err) {
      logger(
        `promotionCommenter: failed to apply hitl label on issue #${issueNumber}: ${err}`,
        'warn',
      );
    }
  }

  return { suggestedScenarios, hitlLabelApplied };
}
