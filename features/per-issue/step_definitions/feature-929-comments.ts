/** The `## ` heading lines of a comment body: what "a comment headed X" is matched against. */
export function commentHeadings(body: string): string[] {
  return body.split('\n').filter(line => line.startsWith('## '));
}

export function isHeaded(body: string, text: string): boolean {
  return commentHeadings(body).some(heading => heading.includes(text));
}
