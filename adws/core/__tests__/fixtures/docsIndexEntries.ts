import type { ConditionalDocEntry, ConditionalDocsRegistry } from '../../conditionalDocsRegistry';

export function entry(overrides: Partial<ConditionalDocEntry> & { docPath: string }): ConditionalDocEntry {
  return { ownedGlobs: [], conditions: ['When X'], decisions: [], ...overrides };
}

export function registryOf(entries: ConditionalDocEntry[]): ConditionalDocsRegistry {
  return { preamble: '# Conditional Documentation\n', entries };
}
