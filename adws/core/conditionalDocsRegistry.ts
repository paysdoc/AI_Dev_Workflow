// Canonical serialized entry format:
//   - <docPath>
//     - Owns:
//       - <glob>
//     - Conditions:
//       - <condition line, verbatim incl. backticks>
//     - Decisions:
//       - <four-digit ADR number>
//
// Rules:
//   - Owns: block omitted when ownedGlobs is empty (legacy compatibility)
//   - Decisions: block omitted when decisions is empty
//   - Decisions: comes last so a parser that predates it reads the items as Conditions lines,
//     which nothing repairs, rather than as Owns globs, which the sweep prunes
//   - Entries separated by a single blank line
//   - preamble holds the "# Conditional Documentation" header text above the first entry
//   - Exactly one trailing newline

export interface ConditionalDocEntry {
  docPath: string;
  ownedGlobs: string[];
  conditions: string[];
  decisions: string[];
}

export interface ConditionalDocsRegistry {
  preamble: string;
  entries: ConditionalDocEntry[];
}

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

export function matchesGlob(glob: string, filePath: string): boolean {
  return globToRegExp(glob).test(filePath);
}

type ActiveList = 'owns' | 'conditions' | 'decisions' | null;

function applyListItem(
  entry: ConditionalDocEntry,
  list: ActiveList,
  text: string,
): void {
  if (list === 'owns') entry.ownedGlobs.push(text);
  else if (list === 'conditions') entry.conditions.push(text);
  else if (list === 'decisions') entry.decisions.push(text);
}

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
  let activeList: ActiveList = null;

  for (let i = firstEntryLine; i < lines.length; i++) {
    const line = lines[i];

    if (/^- /.test(line)) {
      if (currentEntry) entries.push(currentEntry);
      currentEntry = { docPath: line.slice(2), ownedGlobs: [], conditions: [], decisions: [] };
      activeList = null;
    } else if (/^ {2}- Owns:/.test(line)) {
      activeList = 'owns';
    } else if (/^ {2}- Conditions:/.test(line)) {
      activeList = 'conditions';
    } else if (/^ {2}- Decisions:/.test(line)) {
      activeList = 'decisions';
    } else if (/^ {4}- /.test(line)) {
      if (!currentEntry) continue;
      applyListItem(currentEntry, activeList, line.slice(6));
    }
    // blank lines and unrecognized lines are ignored
  }
  if (currentEntry) entries.push(currentEntry);

  return { preamble, entries };
}

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
  if (entry.decisions.length > 0) {
    s += '\n  - Decisions:';
    for (const adr of entry.decisions) {
      s += `\n    - ${adr}`;
    }
  }
  return s;
}

export function serializeConditionalDocs(registry: ConditionalDocsRegistry): string {
  if (registry.entries.length === 0) {
    return registry.preamble;
  }
  return registry.preamble + registry.entries.map(serializeEntry).join('\n\n') + '\n';
}

export function findOwningEntry(
  registry: ConditionalDocsRegistry,
  changedFilePaths: string[],
): ConditionalDocEntry | undefined {
  return registry.entries.find(
    (entry) =>
      entry.ownedGlobs.length > 0 &&
      entry.ownedGlobs.some((glob) => changedFilePaths.some((p) => matchesGlob(glob, p))),
  );
}

/** All entries (document order) whose ownedGlobs match ≥1 changed path. */
export function findOwningEntries(
  registry: ConditionalDocsRegistry,
  changedFilePaths: string[],
): ConditionalDocEntry[] {
  return registry.entries.filter(
    (entry) =>
      entry.ownedGlobs.length > 0 &&
      entry.ownedGlobs.some((glob) => changedFilePaths.some((p) => matchesGlob(glob, p))),
  );
}

function unionDistinct(lists: string[][]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const items of lists) {
    for (const item of items) {
      if (!seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    }
  }
  return result;
}

export function collapseEntries(
  registry: ConditionalDocsRegistry,
  docPathsToCollapse: string[],
  merged: { docPath: string; conditions: string[] },
): { registry: ConditionalDocsRegistry; prunedDocPaths: string[] } {
  const collapseSet = new Set(docPathsToCollapse);
  const collapsed = registry.entries.filter((e) => collapseSet.has(e.docPath));
  const firstIdx = registry.entries.findIndex((e) => collapseSet.has(e.docPath));

  if (firstIdx === -1) {
    return { registry, prunedDocPaths: [] };
  }

  const mergedEntry: ConditionalDocEntry = {
    docPath: merged.docPath,
    conditions: merged.conditions,
    ownedGlobs: unionDistinct(collapsed.map((e) => e.ownedGlobs)),
    decisions: unionDistinct(collapsed.map((e) => e.decisions)),
  };

  const kept: ConditionalDocEntry[] = [];
  let inserted = false;
  for (let i = 0; i < registry.entries.length; i++) {
    const entry = registry.entries[i];
    if (collapseSet.has(entry.docPath)) {
      if (!inserted) {
        kept.push(mergedEntry);
        inserted = true;
      }
    } else {
      kept.push(entry);
    }
  }

  const prunedDocPaths = docPathsToCollapse.filter((p) => p !== merged.docPath);
  return { registry: { ...registry, entries: kept }, prunedDocPaths };
}

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
