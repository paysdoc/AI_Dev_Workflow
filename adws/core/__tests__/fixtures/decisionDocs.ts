export const ADR_44 = 'specs/adr/0044-living-docs-per-module.md';
export const ADR_53 = 'specs/adr/0053-docs-index-health-gate-and-sweep.md';
export const DOC = 'app_docs/feature-a.md';

export function bullets(targets: string[]): string[] {
  return targets.map((target) => `- [ADR](${target}) — a title`);
}

export function docWithSection(...targets: string[]): string {
  return ['# Module', '', '## Overview', '', 'Prose.', '', '## Decisions', '', ...bullets(targets), ''].join('\n');
}
