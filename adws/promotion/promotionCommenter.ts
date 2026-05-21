import { parse as parseVocabulary } from './vocabularyParser.ts';
import { parse as parseScenarios } from './scenarioParser.ts';
import { score } from './promotionScorer.ts';
import { computeThreshold } from './promotionThreshold.ts';
import { applyTagState } from './promotionTagWriter.ts';

const PER_ISSUE_RE = /^features\/per-issue\/feature-\d+\.feature$/;

export interface PromotionCommenterDeps {
  loadVocabulary: () => string;
  fetchChangedFiles: (prNumber: number) => Promise<{ path: string; status: string }[]>;
  readFile: (path: string) => string;
  writeFile: (path: string, content: string) => void;
  postComment: (prNumber: number, body: string) => Promise<void>;
  today: () => string;
  log?: (msg: string, level?: string) => void;
}

export interface SuggestedScenario {
  file: string;
  scenarioHeaderLine: number;
  score: number;
}

export interface PromotionResult {
  suggestedScenarios: SuggestedScenario[];
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
  deps: PromotionCommenterDeps,
): Promise<PromotionResult> {
  const logger = deps.log ?? (() => void 0);
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
      if (result.total < threshold) continue;

      const today = deps.today();
      const updated = applyTagState(content, scenario.headerLine, 'add-suggestion', today);
      deps.writeFile(file.path, updated);
      // Update content for subsequent scenarios in the same file
      content = updated;

      suggestedScenarios.push({
        file: file.path,
        scenarioHeaderLine: scenario.headerLine,
        score: result.total,
      });
    }
  }

  if (suggestedScenarios.length > 0) {
    await deps.postComment(prNumber, formatPromotionComment(suggestedScenarios));
  }

  return { suggestedScenarios };
}
