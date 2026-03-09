import { describe, it, expect } from 'vitest';
import { markdownToAdf, adfToPlainText } from '../adfConverter';

describe('markdownToAdf', () => {
  it('converts a simple paragraph', () => {
    const result = markdownToAdf('Hello world');

    expect(result.version).toBe(1);
    expect(result.type).toBe('doc');
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('paragraph');
    expect(result.content[0].content).toEqual([{ type: 'text', text: 'Hello world' }]);
  });

  it('converts a code block', () => {
    const md = '```typescript\nconst x = 1;\n```';
    const result = markdownToAdf(md);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('codeBlock');
    expect(result.content[0].attrs).toEqual({ language: 'typescript' });
    expect(result.content[0].content).toEqual([{ type: 'text', text: 'const x = 1;' }]);
  });

  it('converts a code block without language', () => {
    const md = '```\nsome code\n```';
    const result = markdownToAdf(md);

    expect(result.content[0].type).toBe('codeBlock');
    expect(result.content[0].attrs).toEqual({});
  });

  it('converts bold text', () => {
    const result = markdownToAdf('This is **bold** text');
    const content = result.content[0].content!;

    expect(content).toHaveLength(3);
    expect(content[0]).toEqual({ type: 'text', text: 'This is ' });
    expect(content[1]).toEqual({ type: 'text', text: 'bold', marks: [{ type: 'strong' }] });
    expect(content[2]).toEqual({ type: 'text', text: ' text' });
  });

  it('converts italic text', () => {
    const result = markdownToAdf('This is _italic_ text');
    const content = result.content[0].content!;

    expect(content[1]).toEqual({ type: 'text', text: 'italic', marks: [{ type: 'em' }] });
  });

  it('converts headings', () => {
    const result = markdownToAdf('## Heading 2');

    expect(result.content[0].type).toBe('heading');
    expect(result.content[0].attrs).toEqual({ level: 2 });
    expect(result.content[0].content).toEqual([{ type: 'text', text: 'Heading 2' }]);
  });

  it('converts bullet lists', () => {
    const md = '- item 1\n- item 2\n- item 3';
    const result = markdownToAdf(md);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('bulletList');
    expect(result.content[0].content).toHaveLength(3);
    expect(result.content[0].content![0].type).toBe('listItem');
  });

  it('converts links', () => {
    const result = markdownToAdf('Visit [example](https://example.com) now');
    const content = result.content[0].content!;

    expect(content[1]).toEqual({
      type: 'text',
      text: 'example',
      marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
    });
  });

  it('handles empty string', () => {
    const result = markdownToAdf('');

    expect(result.version).toBe(1);
    expect(result.type).toBe('doc');
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('paragraph');
  });

  it('handles multiple paragraphs separated by empty lines', () => {
    const md = 'First paragraph\n\nSecond paragraph';
    const result = markdownToAdf(md);

    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe('paragraph');
    expect(result.content[1].type).toBe('paragraph');
  });

  it('handles mixed content', () => {
    const md = '# Title\n\nSome **bold** text\n\n- item 1\n- item 2\n\n```js\ncode()\n```';
    const result = markdownToAdf(md);

    const types = result.content.map(n => n.type);
    expect(types).toEqual(['heading', 'paragraph', 'bulletList', 'codeBlock']);
  });
});

describe('adfToPlainText', () => {
  it('extracts text from a simple ADF document', () => {
    const adf = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ],
    };

    expect(adfToPlainText(adf)).toBe('Hello world');
  });

  it('extracts text from nested content', () => {
    const adf = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'world' },
          ],
        },
      ],
    };

    expect(adfToPlainText(adf)).toBe('Hello world');
  });

  it('handles multiple paragraphs', () => {
    const adf = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
      ],
    };

    expect(adfToPlainText(adf)).toBe('First\nSecond');
  });

  it('returns empty string for null', () => {
    expect(adfToPlainText(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(adfToPlainText(undefined)).toBe('');
  });

  it('returns empty string for non-object', () => {
    expect(adfToPlainText('not an object')).toBe('');
    expect(adfToPlainText(42)).toBe('');
  });

  it('returns empty string for empty document', () => {
    const adf = { type: 'doc', content: [] };
    expect(adfToPlainText(adf)).toBe('');
  });

  it('handles deeply nested ADF', () => {
    const adf = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Item 1' }] },
              ],
            },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Item 2' }] },
              ],
            },
          ],
        },
      ],
    };

    expect(adfToPlainText(adf)).toContain('Item 1');
    expect(adfToPlainText(adf)).toContain('Item 2');
  });

  it('handles ADF with no content array', () => {
    const adf = { type: 'unknown' };
    expect(adfToPlainText(adf)).toBe('');
  });
});
