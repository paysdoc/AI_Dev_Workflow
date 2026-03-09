/**
 * Lightweight converters between Markdown and Atlassian Document Format (ADF).
 * Supports the most common markdown elements without external dependencies.
 */

interface AdfMark {
  readonly type: string;
  readonly attrs?: Record<string, string>;
}

interface AdfNode {
  readonly type: string;
  readonly content?: readonly AdfNode[];
  readonly text?: string;
  readonly marks?: readonly AdfMark[];
  readonly attrs?: Record<string, unknown>;
}

interface AdfDocument {
  readonly version: 1;
  readonly type: 'doc';
  readonly content: readonly AdfNode[];
}

/**
 * Parses inline markdown marks (bold, italic, links) into ADF text nodes.
 */
function parseInlineMarks(text: string): readonly AdfNode[] {
  const nodes: AdfNode[] = [];
  const inlinePattern = /(\*\*(.+?)\*\*|__(.+?)__|_(.+?)_|\*(.+?)\*|\[([^\]]+)\]\(([^)]+)\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlinePattern.exec(text)) !== null) {
    // Add plain text before the match
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }

    if (match[2] || match[3]) {
      // Bold: **text** or __text__
      nodes.push({ type: 'text', text: match[2] || match[3], marks: [{ type: 'strong' }] });
    } else if (match[4] || match[5]) {
      // Italic: _text_ or *text*
      nodes.push({ type: 'text', text: match[4] || match[5], marks: [{ type: 'em' }] });
    } else if (match[6] && match[7]) {
      // Link: [text](url)
      nodes.push({
        type: 'text',
        text: match[6],
        marks: [{ type: 'link', attrs: { href: match[7] } }],
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining plain text
  if (lastIndex < text.length) {
    nodes.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return nodes.length > 0 ? nodes : [{ type: 'text', text }];
}

/**
 * Converts a single line of markdown into ADF paragraph content nodes.
 */
function lineToParagraph(line: string): AdfNode {
  return {
    type: 'paragraph',
    content: parseInlineMarks(line),
  };
}

/**
 * Converts markdown text to a minimal ADF document structure.
 * Supports paragraphs, code blocks, bold, italic, headings, bullet lists, and links.
 */
export function markdownToAdf(markdown: string): AdfDocument {
  if (!markdown) {
    return { version: 1, type: 'doc', content: [{ type: 'paragraph', content: [] }] };
  }

  const lines = markdown.split('\n');
  const content: AdfNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block: ```...```
    if (line.startsWith('```')) {
      const language = line.slice(3).trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing ```
      content.push({
        type: 'codeBlock',
        attrs: language ? { language } : {},
        content: [{ type: 'text', text: codeLines.join('\n') }],
      });
      continue;
    }

    // Heading: # ... (h1-h6)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      content.push({
        type: 'heading',
        attrs: { level: headingMatch[1].length },
        content: parseInlineMarks(headingMatch[2]),
      });
      i++;
      continue;
    }

    // Bullet list item: - ... or * ...
    if (/^[-*]\s+/.test(line)) {
      const listItems: AdfNode[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^[-*]\s+/, '');
        listItems.push({
          type: 'listItem',
          content: [lineToParagraph(itemText)],
        });
        i++;
      }
      content.push({ type: 'bulletList', content: listItems });
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Default: paragraph
    content.push(lineToParagraph(line));
    i++;
  }

  if (content.length === 0) {
    content.push({ type: 'paragraph', content: [] });
  }

  return { version: 1, type: 'doc', content };
}

/**
 * Extracts plain text from an ADF document by recursively walking content arrays.
 * Falls back to empty string for unknown or malformed structures.
 */
export function adfToPlainText(adf: unknown): string {
  if (adf === null || adf === undefined) {
    return '';
  }

  if (typeof adf !== 'object') {
    return '';
  }

  const node = adf as Record<string, unknown>;

  // Extract text from text nodes
  if (node.type === 'text' && typeof node.text === 'string') {
    return node.text;
  }

  // Recursively process content arrays
  if (Array.isArray(node.content)) {
    const parts = (node.content as unknown[]).map(child => adfToPlainText(child));
    const separator = node.type === 'doc' || node.type === 'bulletList' ? '\n' : '';
    return parts.join(separator);
  }

  return '';
}
