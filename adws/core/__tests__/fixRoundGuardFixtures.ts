import { buildFixRoundGuardConfig, evaluateFixRound, type FixRoundVerdict, type GuardRejection } from '../fixRoundGuard';
import type { StackLanguage } from '../stackCoherenceCheck';

export function addedLinesDiff(file: string, lines: readonly string[]): string {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,1 +1,${1 + lines.length} @@`,
    ' unchanged context',
    ...lines.map(line => `+${line}`),
  ].join('\n');
}

export function removedLinesDiff(file: string, lines: readonly string[]): string {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${1 + lines.length} +1,1 @@`,
    ' unchanged context',
    ...lines.map(line => `-${line}`),
  ].join('\n');
}

export function editedLineDiff(file: string, before: string, after: string): string {
  return [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, '@@ -1,2 +1,2 @@', ' unchanged context', `-${before}`, `+${after}`].join('\n');
}

export function contextOnlyDiff(file: string, contextLine: string, addedLine: string): string {
  return [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, '@@ -1,2 +1,3 @@', ` ${contextLine}`, ` unchanged context`, `+${addedLine}`].join('\n');
}

export function touchedFileDiff(file: string, kind: 'added' | 'modified' | 'deleted'): string {
  const header = `diff --git a/${file} b/${file}`;
  if (kind === 'added') {
    return [header, 'new file mode 100644', 'index 0000000..1111111', '--- /dev/null', `+++ b/${file}`, '@@ -0,0 +1 @@', '+content'].join('\n');
  }
  if (kind === 'deleted') {
    return [header, 'deleted file mode 100644', 'index 1111111..0000000', `--- a/${file}`, '+++ /dev/null', '@@ -1 +0,0 @@', '-content'].join('\n');
  }
  return [header, 'index 1111111..2222222 100644', `--- a/${file}`, `+++ b/${file}`, '@@ -1 +1 @@', '-before', '+after'].join('\n');
}

export function reasonsOf(verdict: FixRoundVerdict): readonly GuardRejection[] {
  if (verdict.accepted) throw new Error('Expected the fix round to be rejected, but it was accepted');
  return verdict.reasons;
}

export function judge(languages: readonly StackLanguage[], section: string, diff: string): FixRoundVerdict {
  return evaluateFixRound(diff, buildFixRoundGuardConfig(languages, section));
}
