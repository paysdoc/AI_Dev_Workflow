import { isGherkinFramework } from './stepDefDetection';

export interface StackCoherenceInput {
  testFramework: string;
  bddFramework: string;
  runTests: string;
  runScenariosByTag: string;
}

export type StackCoherenceWarningCode = 'language-mismatch' | 'non-gherkin-bdd';

export interface StackCoherenceWarning {
  code: StackCoherenceWarningCode;
  message: string;
}

export interface StackCoherenceResult {
  ok: boolean;
  warnings: StackCoherenceWarning[];
}

type StackLanguage = 'javascript' | 'python' | 'go' | 'rust' | 'ruby';

// Ordered: specific tokens before generic to prevent prefix conflicts.
const LANGUAGE_TOKENS: Array<[string, StackLanguage]> = [
  ['cucumber-js', 'javascript'],
  ['cucumber-ruby', 'ruby'],
  ['cucumber-rs', 'rust'],
  ['pytest-bdd', 'python'],
  ['pytest', 'python'],
  ['behave', 'python'],
  ['tox', 'python'],
  ['python', 'python'],
  ['godog', 'go'],
  ['cargo', 'rust'], // before 'go test': 'cargo test' contains the substring 'go test'
  ['go test', 'go'],
  ['rspec', 'ruby'],
  ['bundle', 'ruby'],
  ['rake', 'ruby'],
  ['vitest', 'javascript'],
  ['jest', 'javascript'],
  ['mocha', 'javascript'],
  ['jasmine', 'javascript'],
  ['bunx', 'javascript'],
  ['bun', 'javascript'],
  ['npx', 'javascript'],
  ['npm', 'javascript'],
  ['pnpm', 'javascript'],
  ['yarn', 'javascript'],
  ['node', 'javascript'],
  ['tsx', 'javascript'],
  ['cucumber', 'javascript'], // generic, last
];

function inferLanguage(text: string): StackLanguage | null {
  const lower = text.trim().toLowerCase();
  if (lower === '') return null;
  for (const [token, lang] of LANGUAGE_TOKENS) {
    if (lower.includes(token)) return lang;
  }
  return null;
}

export function stackCoherenceCheck(input: StackCoherenceInput): StackCoherenceResult {
  const warnings: StackCoherenceWarning[] = [];

  // Gherkin-mandate check
  if (input.bddFramework.trim() !== '' && !isGherkinFramework(input.bddFramework)) {
    warnings.push({
      code: 'non-gherkin-bdd',
      message: `BDD framework '${input.bddFramework}' is not a recognized Gherkin-based runner. ADW mandates Gherkin .feature scenarios; a non-Gherkin runner breaks the promotion / per-issue-sweep / vocabulary subsystems.`,
    });
  }

  // Language-coherence check
  const signals: Array<{ name: string; value: string }> = [
    { name: 'testFramework', value: input.testFramework },
    { name: 'bddFramework', value: input.bddFramework },
    { name: 'runTests', value: input.runTests },
    { name: 'runScenariosByTag', value: input.runScenariosByTag },
  ];

  const inferred = signals.map(s => ({ ...s, lang: inferLanguage(s.value) }));
  const knownLangs = new Set(inferred.map(s => s.lang).filter((l): l is StackLanguage => l !== null));

  if (knownLangs.size > 1) {
    const contributing = inferred
      .filter(s => s.lang !== null)
      .map(s => `${s.name} '${s.value}'→${s.lang}`)
      .join(', ');
    warnings.push({
      code: 'language-mismatch',
      message: `Detected stack spans multiple languages — ${contributing}. adw_init likely mis-detected the BDD runner (it defaults to cucumber-js on non-recognition); confirm .adw/commands.md and .adw/scenarios.md.`,
    });
  }

  return { ok: warnings.length === 0, warnings };
}
