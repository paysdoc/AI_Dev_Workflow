export type ExecutionPattern = 'subprocess' | 'phase-import' | 'mock-query';

export interface VocabularyEntry {
  phrase: string;
  assertionTarget: string;
  pattern: ExecutionPattern;
}

export interface VocabularyRegistry {
  entries: Map<string, VocabularyEntry>;
  surfaceExamples: string[];
}

export interface Step {
  keyword: string;
  text: string;
  line: number;
}

export interface Scenario {
  name: string;
  tags: string[];
  steps: Step[];
  startLine: number;
  endLine: number;
  headerLine: number;
}

export interface PromotionStats {
  promotedCount90d: number;
  totalPerIssueCount90d: number;
}

export interface ScoreBreakdown {
  surfaceMatch: number;
  executionPattern: number;
  phaseCount: number;
}

export interface ScoreResult {
  total: number;
  breakdown: ScoreBreakdown;
}

export type TagState = 'add-suggestion' | 'refresh-date' | 'remove-suggestion' | 'strip-approval';

export interface ApprovedScenario {
  headerLine: number;
  startLine: number;
  endLine: number;
  scenarioName: string;
}

export interface MovedScenarioResult {
  sourcePath: string;
  destPath: string;
  scenarioName: string;
  branchName: string;
  prNumber: number | null;
  prUrl: string | null;
  skipped: boolean;
}

export interface PromotionMoverResult {
  moved: MovedScenarioResult[];
}
