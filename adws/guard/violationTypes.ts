/**
 * violationTypes.ts — cross-rule types shared by the git/gh guard's entry
 * point (`adws/checkGitGhGuard.ts`) and its rule modules
 * (`adws/guard/identityRule.ts`, `adws/guard/constructionRule.ts`,
 * `adws/guard/extractionRule.ts`).
 *
 * Kept in their own module so a rule module never has to import the entry
 * point (which would invert the dependency direction) just to name its own
 * violation shape.
 */

/** The guard's four independent AST rules. */
export type ViolationRule = 'git-gh-shellout' | 'cwd-derived-identity' | 'unsanctioned-construction' | 'extraction-readiness';

/** One detected violation: where it was found, what was seen, and which rule fired. */
export type Violation = { file: string; line: number; command: string; rule: ViolationRule };
