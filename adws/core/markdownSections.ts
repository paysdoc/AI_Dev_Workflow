/**
 * Parses a markdown file with `## Heading` sections and returns a map of
 * lowercased heading text → trimmed body content.
 */
export function parseMarkdownSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = content.split('\n');

  let currentHeading: string | null = null;
  const bodyLines: string[] = [];

  function flush() {
    if (currentHeading !== null) {
      sections[currentHeading] = bodyLines.join('\n').trim();
    }
    bodyLines.length = 0;
  }

  for (const line of lines) {
    const match = line.match(/^##\s+(.+)$/);
    if (match) {
      flush();
      currentHeading = match[1].trim().toLowerCase();
    } else {
      bodyLines.push(line);
    }
  }
  flush();

  return sections;
}

export function stripHtmlComments(value: string): string {
  return value.replace(/<!--[\s\S]*?-->/g, '').trim();
}

/** The section's value as written, comments stripped and trimmed; `null` when the section is absent or empty. */
export function sectionValue(sections: Readonly<Record<string, string>>, heading: string): string | null {
  const value = stripHtmlComments(sections[heading.toLowerCase()] ?? '');
  return value === '' ? null : value;
}
