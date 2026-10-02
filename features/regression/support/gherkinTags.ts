/**
 * The tags a feature file's text gives a scenario. A tag block is the tag lines directly above a
 * header, blank lines between them allowed. A scenario carries its own block and its Feature's,
 * which it inherits as Gherkin defines: the promotion sweep writes its marker into the Feature's
 * block, so a reader that looked only above the `Scenario:` line would never see it. No hooks and no
 * import-time side effects, so any step file may import it.
 */

/** The tags in the block directly above the header at `headerIdx`. */
export function extractTagBlock(lines: readonly string[], headerIdx: number): string[] {
  const tags: string[] = [];
  for (let i = headerIdx - 1; i >= 0; i--) {
    const trimmed = (lines[i] ?? '').trimStart();
    if (trimmed.startsWith('@')) {
      tags.push(...trimmed.split(/\s+/).filter((t) => t.startsWith('@')));
    } else if (trimmed.length > 0) {
      break;
    }
  }
  return tags;
}

function headerIndex(lines: readonly string[], keyword: string, name?: string): number {
  return lines.findIndex((line) => {
    const trimmed = line.trimStart();
    return trimmed.startsWith(keyword) && (name === undefined || trimmed.slice(keyword.length).trim() === name);
  });
}

/** The named scenario's own tags followed by its Feature's, or undefined when the file holds no such scenario. */
export function scenarioTags(content: string, scenarioName: string): string[] | undefined {
  const lines = content.split('\n');
  const scenarioIdx = headerIndex(lines, 'Scenario:', scenarioName);
  if (scenarioIdx < 0) return undefined;

  const featureIdx = headerIndex(lines, 'Feature:');
  return [...extractTagBlock(lines, scenarioIdx), ...(featureIdx < 0 ? [] : extractTagBlock(lines, featureIdx))];
}
