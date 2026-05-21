import type { ExecutionPattern, VocabularyEntry, VocabularyRegistry } from './types.ts';

const KNOWN_PATTERNS = new Set<ExecutionPattern>(['subprocess', 'phase-import', 'mock-query']);

function toPattern(raw: string): ExecutionPattern {
  const trimmed = raw.trim().toLowerCase();
  // Unknown pattern values fall back to mock-query (lowest weight, safe default)
  if (KNOWN_PATTERNS.has(trimmed as ExecutionPattern)) return trimmed as ExecutionPattern;
  return 'mock-query';
}

function parseTableRows(block: string): VocabularyEntry[] {
  const entries: VocabularyEntry[] = [];
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
    const cols = trimmed
      .slice(1, -1)
      .split('|')
      .map(c => c.trim());
    // Expected: # | Phrase | Semantics | Pattern | Assertion target (5 columns)
    if (cols.length < 5) continue;
    // Skip header/separator rows
    if (cols[1].startsWith('-') || cols[1].toLowerCase() === 'phrase') continue;
    const phrase = cols[1].replace(/`/g, '').trim();
    const pattern = toPattern(cols[3]);
    const assertionTarget = cols[4].trim();
    if (!phrase || !assertionTarget) continue;
    entries.push({ phrase, assertionTarget, pattern });
  }
  return entries;
}

function parseSurfaceExamples(content: string): string[] {
  const marker = '## Observability Surfaces (Examples)';
  const idx = content.indexOf(marker);
  if (idx === -1) return [];

  const after = content.slice(idx + marker.length);
  const nextSection = after.search(/^##\s/m);
  const block = nextSection === -1 ? after : after.slice(0, nextSection);

  return block
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && (l.startsWith('-') || l.startsWith('*') || /^\w/.test(l)))
    .map(l => l.replace(/^[-*]\s*/, '').trim())
    .filter(l => l.length > 0);
}

export function parse(content: string): VocabularyRegistry {
  const entries = new Map<string, VocabularyEntry>();

  // Extract table sections under ## Given, ## When, ## Then
  const sectionRe = /^##\s+(Given|When|Then)\b/gm;
  let match: RegExpExecArray | null;
  const sections: { start: number }[] = [];
  while ((match = sectionRe.exec(content)) !== null) {
    sections.push({ start: match.index });
  }

  for (let i = 0; i < sections.length; i++) {
    const start = sections[i].start;
    const end = i + 1 < sections.length ? sections[i + 1].start : content.length;
    const block = content.slice(start, end);
    for (const entry of parseTableRows(block)) {
      entries.set(entry.phrase, entry);
    }
  }

  const surfaceExamples = parseSurfaceExamples(content);
  return { entries, surfaceExamples };
}
