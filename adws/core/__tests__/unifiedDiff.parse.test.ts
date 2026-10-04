import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff, touchedPaths } from '../unifiedDiff';

function diffOf(...lines: string[]): string {
  return lines.join('\n');
}

describe('parseUnifiedDiff', () => {
  it('reads a modified file: both paths, the added and the removed lines, no context', () => {
    const files = parseUnifiedDiff(
      diffOf(
        'diff --git a/src/a.ts b/src/a.ts',
        'index 1111111..2222222 100644',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,3 +1,3 @@',
        ' context before',
        '-old line',
        '+new line',
        ' context after',
      ),
    );

    expect(files).toEqual([
      { oldPath: 'src/a.ts', newPath: 'src/a.ts', addedLines: ['new line'], removedLines: ['old line'] },
    ]);
  });

  it('reads a created file: it has no old path', () => {
    const files = parseUnifiedDiff(
      diffOf(
        'diff --git a/src/new.ts b/src/new.ts',
        'new file mode 100644',
        'index 0000000..3333333',
        '--- /dev/null',
        '+++ b/src/new.ts',
        '@@ -0,0 +1,2 @@',
        '+first',
        '+second',
      ),
    );

    expect(files).toEqual([{ oldPath: null, newPath: 'src/new.ts', addedLines: ['first', 'second'], removedLines: [] }]);
  });

  it('reads a deleted file: it has no new path', () => {
    const files = parseUnifiedDiff(
      diffOf(
        'diff --git a/src/old.ts b/src/old.ts',
        'deleted file mode 100644',
        'index 4444444..0000000',
        '--- a/src/old.ts',
        '+++ /dev/null',
        '@@ -1,2 +0,0 @@',
        '-first',
        '-second',
      ),
    );

    expect(files).toEqual([{ oldPath: 'src/old.ts', newPath: null, addedLines: [], removedLines: ['first', 'second'] }]);
  });

  it('reads an empty file that is created: no hunk, and still no old path', () => {
    const files = parseUnifiedDiff(
      diffOf('diff --git a/src/.eslintignore b/src/.eslintignore', 'new file mode 100644', 'index 0000000..e69de29'),
    );

    expect(files).toEqual([{ oldPath: null, newPath: 'src/.eslintignore', addedLines: [], removedLines: [] }]);
  });

  it('reads an empty file that is deleted: no hunk, and still no new path', () => {
    const files = parseUnifiedDiff(
      diffOf('diff --git a/src/.eslintignore b/src/.eslintignore', 'deleted file mode 100644', 'index e69de29..0000000'),
    );

    expect(files).toEqual([{ oldPath: 'src/.eslintignore', newPath: null, addedLines: [], removedLines: [] }]);
  });

  it('reads several files in one diff, one entry each, in order', () => {
    const files = parseUnifiedDiff(
      diffOf(
        'diff --git a/one.ts b/one.ts',
        '--- a/one.ts',
        '+++ b/one.ts',
        '@@ -1 +1 @@',
        '-a',
        '+b',
        'diff --git a/two.ts b/two.ts',
        '--- a/two.ts',
        '+++ b/two.ts',
        '@@ -1 +1 @@',
        '-c',
        '+d',
        'diff --git a/three.ts b/three.ts',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/three.ts',
        '@@ -0,0 +1 @@',
        '+e',
      ),
    );

    expect(files.map(file => file.newPath)).toEqual(['one.ts', 'two.ts', 'three.ts']);
    expect(files.map(file => file.addedLines)).toEqual([['b'], ['d'], ['e']]);
    expect(files.map(file => file.removedLines)).toEqual([['a'], ['c'], []]);
  });

  it('reads every hunk of a file', () => {
    const files = parseUnifiedDiff(
      diffOf(
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,2 +1,2 @@',
        ' keep',
        '-first old',
        '+first new',
        '@@ -20,2 +20,2 @@',
        ' keep',
        '-second old',
        '+second new',
      ),
    );

    expect(files).toHaveLength(1);
    expect(files[0].addedLines).toEqual(['first new', 'second new']);
    expect(files[0].removedLines).toEqual(['first old', 'second old']);
  });

  it('counts an added line that starts with "++" as an added line, not as a header', () => {
    const files = parseUnifiedDiff(
      diffOf('diff --git a/x.txt b/x.txt', '--- a/x.txt', '+++ b/x.txt', '@@ -1 +1,2 @@', ' keep', '+++ x'),
    );

    expect(files).toEqual([{ oldPath: 'x.txt', newPath: 'x.txt', addedLines: ['++ x'], removedLines: [] }]);
  });

  it('counts a removed line that starts with "--" as a removed line, not as a header', () => {
    const files = parseUnifiedDiff(
      diffOf('diff --git a/x.txt b/x.txt', '--- a/x.txt', '+++ b/x.txt', '@@ -1,2 +1 @@', ' keep', '--- y'),
    );

    expect(files).toEqual([{ oldPath: 'x.txt', newPath: 'x.txt', addedLines: [], removedLines: ['-- y'] }]);
  });

  it('does not let a line of a hunk that looks like a header change the file’s paths', () => {
    const files = parseUnifiedDiff(
      diffOf(
        'diff --git a/x.txt b/x.txt',
        '--- a/x.txt',
        '+++ b/x.txt',
        '@@ -1 +1,3 @@',
        ' keep',
        '+++ b/tsconfig.json',
        '+--- a/tsconfig.json',
      ),
    );

    expect(files).toHaveLength(1);
    expect(touchedPaths(files[0])).toEqual(['x.txt']);
    expect(files[0].addedLines).toEqual(['++ b/tsconfig.json', '--- a/tsconfig.json']);
  });

  it('ignores the "No newline at end of file" marker', () => {
    const files = parseUnifiedDiff(
      diffOf(
        'diff --git a/x.txt b/x.txt',
        '--- a/x.txt',
        '+++ b/x.txt',
        '@@ -1 +1 @@',
        '-old',
        '\\ No newline at end of file',
        '+new',
        '\\ No newline at end of file',
      ),
    );

    expect(files).toEqual([{ oldPath: 'x.txt', newPath: 'x.txt', addedLines: ['new'], removedLines: ['old'] }]);
  });

  it('takes the paths of a binary entry from its header and reads no lines', () => {
    const files = parseUnifiedDiff(
      diffOf('diff --git a/x.png b/x.png', 'index 1111111..2222222 100644', 'Binary files a/x.png and b/x.png differ'),
    );

    expect(files).toEqual([{ oldPath: 'x.png', newPath: 'x.png', addedLines: [], removedLines: [] }]);
  });

  it('knows a binary file that is created, and one that is deleted', () => {
    const files = parseUnifiedDiff(
      diffOf(
        'diff --git a/new.png b/new.png',
        'new file mode 100644',
        'index 0000000..2222222',
        'Binary files /dev/null and b/new.png differ',
        'diff --git a/old.png b/old.png',
        'deleted file mode 100644',
        'index 1111111..0000000',
        'Binary files a/old.png and /dev/null differ',
      ),
    );

    expect(files.map(file => [file.oldPath, file.newPath])).toEqual([
      [null, 'new.png'],
      ['old.png', null],
    ]);
  });

  it('takes the paths of a mode-only entry from its header and reads no lines', () => {
    const files = parseUnifiedDiff(diffOf('diff --git a/script.sh b/script.sh', 'old mode 100644', 'new mode 100755'));

    expect(files).toEqual([{ oldPath: 'script.sh', newPath: 'script.sh', addedLines: [], removedLines: [] }]);
  });

  it('unquotes a quoted path', () => {
    const files = parseUnifiedDiff(
      diffOf(
        'diff --git "a/sp ce\\"q.ts" "b/sp ce\\"q.ts"',
        '--- "a/sp ce\\"q.ts"',
        '+++ "b/sp ce\\"q.ts"',
        '@@ -1 +1 @@',
        '-a',
        '+b',
      ),
    );

    expect(files.map(file => [file.oldPath, file.newPath])).toEqual([['sp ce"q.ts', 'sp ce"q.ts']]);
  });

  it('unquotes the backslash and the tab of a quoted path', () => {
    const files = parseUnifiedDiff(diffOf('diff --git "a/back\\\\slash\\tx.ts" "b/back\\\\slash\\tx.ts"', 'old mode 100644', 'new mode 100755'));

    expect(files.map(file => file.newPath)).toEqual(['back\\slash\tx.ts']);
  });

  it('reads an unquoted path with a space in it', () => {
    const files = parseUnifiedDiff(
      diffOf(
        'diff --git a/my docs/read me.md b/my docs/read me.md',
        '--- a/my docs/read me.md\t',
        '+++ b/my docs/read me.md\t',
        '@@ -1 +1 @@',
        '-a',
        '+b',
      ),
    );

    expect(files.map(file => [file.oldPath, file.newPath])).toEqual([['my docs/read me.md', 'my docs/read me.md']]);
  });

  it('takes the paths of a space-containing binary entry from the git header', () => {
    const files = parseUnifiedDiff(
      diffOf('diff --git a/my docs/pic.png b/my docs/pic.png', 'Binary files a/my docs/pic.png and b/my docs/pic.png differ'),
    );

    expect(files.map(file => [file.oldPath, file.newPath])).toEqual([['my docs/pic.png', 'my docs/pic.png']]);
  });

  it('reads both paths of a rename', () => {
    const files = parseUnifiedDiff(
      diffOf(
        'diff --git a/tsconfig.json b/tsconfig.old.json',
        'similarity index 100%',
        'rename from tsconfig.json',
        'rename to tsconfig.old.json',
      ),
    );

    expect(files.map(file => [file.oldPath, file.newPath])).toEqual([['tsconfig.json', 'tsconfig.old.json']]);
  });

  it('reads a diff that ends with a newline', () => {
    const files = parseUnifiedDiff(diffOf('diff --git a/x.txt b/x.txt', '--- a/x.txt', '+++ b/x.txt', '@@ -1 +1 @@', '-a', '+b', ''));

    expect(files).toEqual([{ oldPath: 'x.txt', newPath: 'x.txt', addedLines: ['b'], removedLines: ['a'] }]);
  });

  it('reads blank lines of a hunk as context', () => {
    const files = parseUnifiedDiff(diffOf('diff --git a/x.txt b/x.txt', '--- a/x.txt', '+++ b/x.txt', '@@ -1,3 +1,3 @@', '', '-a', '+b', ''));

    expect(files).toEqual([{ oldPath: 'x.txt', newPath: 'x.txt', addedLines: ['b'], removedLines: ['a'] }]);
  });

  it('keeps an added blank line', () => {
    const files = parseUnifiedDiff(diffOf('diff --git a/x.txt b/x.txt', '--- a/x.txt', '+++ b/x.txt', '@@ -1 +1,2 @@', ' a', '+'));

    expect(files[0].addedLines).toEqual(['']);
  });

  it('reads an empty string as no files', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });

  it('reads text that holds no file header as no files', () => {
    expect(parseUnifiedDiff('just some text\n+not a diff\n')).toEqual([]);
  });
});
