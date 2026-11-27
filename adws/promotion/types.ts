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
