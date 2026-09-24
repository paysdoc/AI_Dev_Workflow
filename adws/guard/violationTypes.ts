/**
 * Kept in their own module so a rule module never has to import the entry
 * point (which would invert the dependency direction) just to name its own
 * violation shape.
 */

export type ViolationRule = 'git-gh-shellout' | 'cwd-derived-identity' | 'unsanctioned-construction';

export type Violation = { file: string; line: number; command: string; rule: ViolationRule };
