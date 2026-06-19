// Canonical serialized entry format:
//   - <docPath>
//     - Owns:
//       - <glob>
//     - Conditions:
//       - <condition line, verbatim incl. backticks>
//
// Rules:
//   - Owns: block omitted when ownedGlobs is empty (legacy compatibility)
//   - Entries separated by a single blank line
//   - preamble holds the "# Conditional Documentation" header text above the first entry
//   - Exactly one trailing newline

export interface ConditionalDocEntry {
  docPath: string;
  ownedGlobs: string[];
  conditions: string[];
}

export interface ConditionalDocsRegistry {
  preamble: string;
  entries: ConditionalDocEntry[];
}

// ---------------------------------------------------------------------------
// Glob matcher (pure, no dependency)
// ---------------------------------------------------------------------------

function escapeRegexLiteral(ch: string): string {
  return /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

function globToRegExp(glob: string): RegExp {
  let pattern = '';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*' && i + 1 < glob.length && glob[i + 1] === '*') {
      pattern += '.*';
      i += 2;
      if (i < glob.length && glob[i] === '/') i++;
    } else if (ch === '*') {
      pattern += '[^/]*';
      i++;
    } else if (ch === '?') {
      pattern += '[^/]';
      i++;
    } else {
      pattern += escapeRegexLiteral(ch);
      i++;
    }
  }
  return new RegExp(`^${pattern}$`);
}

function matchesGlob(glob: string, filePath: string): boolean {
  return globToRegExp(glob).test(filePath);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseConditionalDocs(content: string): ConditionalDocsRegistry {
  if (!content.trim()) return { preamble: '', entries: [] };

  const lines = content.split('\n');

  let firstEntryLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^- /.test(lines[i])) {
      firstEntryLine = i;
      break;
    }
  }

  if (firstEntryLine === -1) {
    return { preamble: content, entries: [] };
  }

  const preamble = lines.slice(0, firstEntryLine).join('\n') + '\n';

  const entries: ConditionalDocEntry[] = [];
  let currentEntry: ConditionalDocEntry | null = null;
  let activeList: 'owns' | 'conditions' | null = null;

  for (let i = firstEntryLine; i < lines.length; i++) {
    const line = lines[i];

    if (/^- /.test(line)) {
      if (currentEntry) entries.push(currentEntry);
      currentEntry = { docPath: line.slice(2), ownedGlobs: [], conditions: [] };
      activeList = null;
    } else if (/^ {2}- Owns:/.test(line)) {
      activeList = 'owns';
    } else if (/^ {2}- Conditions:/.test(line)) {
      activeList = 'conditions';
    } else if (/^ {4}- /.test(line)) {
      if (!currentEntry) continue;
      const text = line.slice(6);
      if (activeList === 'owns') {
        currentEntry.ownedGlobs.push(text);
      } else if (activeList === 'conditions') {
        currentEntry.conditions.push(text);
      }
    }
    // blank lines and unrecognized lines are ignored
  }
  if (currentEntry) entries.push(currentEntry);

  return { preamble, entries };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

function serializeEntry(entry: ConditionalDocEntry): string {
  let s = `- ${entry.docPath}`;
  if (entry.ownedGlobs.length > 0) {
    s += '\n  - Owns:';
    for (const glob of entry.ownedGlobs) {
      s += `\n    - ${glob}`;
    }
  }
  s += '\n  - Conditions:';
  for (const cond of entry.conditions) {
    s += `\n    - ${cond}`;
  }
  return s;
}

export function serializeConditionalDocs(registry: ConditionalDocsRegistry): string {
  if (registry.entries.length === 0) {
    return registry.preamble;
  }
  return registry.preamble + registry.entries.map(serializeEntry).join('\n\n') + '\n';
}

// ---------------------------------------------------------------------------
// Ownership query
// ---------------------------------------------------------------------------

export function findOwningEntry(
  registry: ConditionalDocsRegistry,
  changedFilePaths: string[],
): ConditionalDocEntry | undefined {
  for (const entry of registry.entries) {
    if (entry.ownedGlobs.length === 0) continue;
    for (const glob of entry.ownedGlobs) {
      for (const filePath of changedFilePaths) {
        if (matchesGlob(glob, filePath)) return entry;
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Upsert (pure / immutable)
// ---------------------------------------------------------------------------

export function upsertEntry(
  registry: ConditionalDocsRegistry,
  entry: ConditionalDocEntry,
): ConditionalDocsRegistry {
  const idx = registry.entries.findIndex((e) => e.docPath === entry.docPath);
  if (idx === -1) {
    return { ...registry, entries: [...registry.entries, entry] };
  }
  const newEntries = [...registry.entries];
  newEntries[idx] = entry;
  return { ...registry, entries: newEntries };
}
