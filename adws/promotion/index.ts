export { parse as parseVocabulary } from './vocabularyParser.ts';
export { parse as parseScenarios } from './scenarioParser.ts';
export { score, SURFACE_MATCH_WEIGHT, SUBPROCESS_WEIGHT, PHASE_IMPORT_WEIGHT, MOCK_QUERY_WEIGHT, EXTRA_PHASE_WEIGHT } from './promotionScorer.ts';
export { computeThreshold, BOOTSTRAP_THRESHOLD } from './promotionThreshold.ts';
export { applyTagState } from './promotionTagWriter.ts';
export { runPromotionCommenter } from './promotionCommenter.ts';
export type {
  ExecutionPattern,
  VocabularyEntry,
  VocabularyRegistry,
  Scenario,
  Step,
  PromotionStats,
  ScoreBreakdown,
  ScoreResult,
  TagState,
} from './types.ts';
export type { PromotionCommenterDeps, PromotionResult, SuggestedScenario } from './promotionCommenter.ts';
