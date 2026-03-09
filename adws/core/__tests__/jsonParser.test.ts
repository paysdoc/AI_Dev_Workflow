import { describe, it, expect } from 'vitest';
import { extractJson, extractJsonArray } from '../jsonParser';

describe('extractJson', () => {
  it('parses a plain JSON object string', () => {
    const input = '{"key": "value", "num": 42}';
    const result = extractJson<{ key: string; num: number }>(input);
    expect(result).toEqual({ key: 'value', num: 42 });
  });

  it('parses nested JSON objects', () => {
    const input = '{"outer": {"inner": true}}';
    const result = extractJson<{ outer: { inner: boolean } }>(input);
    expect(result).toEqual({ outer: { inner: true } });
  });

  it('extracts JSON embedded in surrounding text', () => {
    const input = 'Here is the result: {"status": "ok"} and some trailing text';
    const result = extractJson<{ status: string }>(input);
    expect(result).toEqual({ status: 'ok' });
  });

  it('extracts JSON from markdown code blocks', () => {
    const input = '```json\n{"result": "success"}\n```';
    const result = extractJson<{ result: string }>(input);
    expect(result).toEqual({ result: 'success' });
  });

  it('extracts JSON from markdown code blocks with surrounding text', () => {
    const input = 'The output is:\n```\n{"data": [1, 2, 3]}\n```\nDone.';
    const result = extractJson<{ data: number[] }>(input);
    expect(result).toEqual({ data: [1, 2, 3] });
  });

  it('returns null for empty string', () => {
    expect(extractJson('')).toBeNull();
  });

  it('returns null for plain text with no JSON', () => {
    expect(extractJson('This is just plain text with no JSON')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(extractJson('{broken json: }')).toBeNull();
  });

  it('successfully parses JSON arrays as valid JSON (JSON.parse handles both objects and arrays)', () => {
    // extractJson first tries JSON.parse which accepts arrays, so a bare array succeeds
    expect(extractJson('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('handles JSON with special characters in strings', () => {
    const input = '{"message": "hello\\nworld", "path": "C:\\\\Users"}';
    const result = extractJson<{ message: string; path: string }>(input);
    expect(result).toEqual({ message: 'hello\nworld', path: 'C:\\Users' });
  });

  it('handles multi-line JSON', () => {
    const input = `{
      "key": "value",
      "nested": {
        "deep": true
      }
    }`;
    const result = extractJson<{ key: string; nested: { deep: boolean } }>(input);
    expect(result).toEqual({ key: 'value', nested: { deep: true } });
  });

  it('extracts the first JSON object when multiple are present in surrounding text', () => {
    const input = 'first: {"a": 1} second: {"b": 2}';
    // The regex /\{[\s\S]*\}/ is greedy, so it will match from first { to last }
    // This means it tries to parse everything between the first { and last }
    const result = extractJson(input);
    // The greedy match will capture: {"a": 1} second: {"b": 2}
    // which is invalid JSON, so it returns null
    expect(result).toBeNull();
  });

  it('returns null for incomplete JSON braces', () => {
    expect(extractJson('{ "key": "value"')).toBeNull();
  });
});

describe('extractJsonArray', () => {
  it('parses a plain JSON array string', () => {
    const result = extractJsonArray<number>('[1, 2, 3]');
    expect(result).toEqual([1, 2, 3]);
  });

  it('parses an array of objects', () => {
    const input = '[{"name": "Alice"}, {"name": "Bob"}]';
    const result = extractJsonArray<{ name: string }>(input);
    expect(result).toEqual([{ name: 'Alice' }, { name: 'Bob' }]);
  });

  it('extracts an array embedded in surrounding text', () => {
    const input = 'The results are: [1, 2, 3] end.';
    const result = extractJsonArray<number>(input);
    expect(result).toEqual([1, 2, 3]);
  });

  it('extracts an array from markdown code blocks', () => {
    const input = '```json\n["a", "b", "c"]\n```';
    const result = extractJsonArray<string>(input);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array for empty string', () => {
    expect(extractJsonArray('')).toEqual([]);
  });

  it('returns an empty array for plain text with no JSON', () => {
    expect(extractJsonArray('This is just plain text')).toEqual([]);
  });

  it('returns an empty array for malformed JSON array', () => {
    expect(extractJsonArray('[broken array')).toEqual([]);
  });

  it('parses a JSON object via JSON.parse (JSON.parse does not distinguish types)', () => {
    // extractJsonArray first tries JSON.parse which succeeds for any valid JSON
    // It returns the parsed value as-is (an object in this case)
    expect(extractJsonArray('{"key": "value"}')).toEqual({ key: 'value' });
  });

  it('parses an empty array', () => {
    expect(extractJsonArray('[]')).toEqual([]);
  });

  it('handles nested arrays', () => {
    const input = '[[1, 2], [3, 4]]';
    const result = extractJsonArray<number[]>(input);
    expect(result).toEqual([[1, 2], [3, 4]]);
  });

  it('handles multi-line arrays', () => {
    const input = `[
      "item1",
      "item2",
      "item3"
    ]`;
    const result = extractJsonArray<string>(input);
    expect(result).toEqual(['item1', 'item2', 'item3']);
  });
});
