export interface DiffFile {
  /** `null` for a file the diff creates. */
  readonly oldPath: string | null;
  /** `null` for a file the diff deletes. */
  readonly newPath: string | null;
  readonly addedLines: readonly string[];
  readonly removedLines: readonly string[];
}

interface FileUnderRead {
  oldPath: string | null;
  newPath: string | null;
  readonly addedLines: string[];
  readonly removedLines: string[];
  inHunk: boolean;
}

type HeaderReader = (file: FileUnderRead, value: string) => void;

const FILE_HEADER = 'diff --git ';
const NO_FILE = '/dev/null';
const OLD_PREFIX = 'a/';
const NEW_PREFIX = 'b/';

const QUOTED_ESCAPES: Readonly<Record<string, string>> = { '"': '"', '\\': '\\', t: '\t', n: '\n' };

interface QuotedToken {
  readonly value: string;
  readonly end: number;
}

/** Reads the C-style quoted string that starts at `start`. Octal escapes are left as written: no path that matters needs them. */
function readQuoted(text: string, start: number): QuotedToken {
  let value = '';
  let index = start + 1;
  while (index < text.length && text[index] !== '"') {
    const escaped = text[index] === '\\' ? QUOTED_ESCAPES[text[index + 1]] : undefined;
    value += escaped ?? text[index];
    index += escaped === undefined ? 1 : 2;
  }
  return { value, end: index + 1 };
}

function stripPrefix(path: string, prefix: string): string {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** A `---`, `+++` or `rename` path: possibly quoted, possibly followed by the tab git adds after a path with spaces. */
function readHeaderPath(raw: string, prefix: string): string | null {
  const path = raw.startsWith('"') ? readQuoted(raw, 0).value : raw.replace(/\t.*$/, '');
  return path === NO_FILE ? null : stripPrefix(path, prefix);
}

/**
 * With renames off, both paths of a header are the same, and that is the only way to split paths that hold spaces:
 * `a/<path> b/<path>`.
 */
function splitBareHeader(rest: string): readonly [string, string] | null {
  const pathLength = (rest.length - OLD_PREFIX.length - ` ${NEW_PREFIX}`.length) / 2;
  const first = rest.slice(0, OLD_PREFIX.length + pathLength);
  const second = rest.slice(OLD_PREFIX.length + pathLength + 1);
  const symmetric = Number.isInteger(pathLength) && pathLength >= 0 && first.slice(OLD_PREFIX.length) === second.slice(NEW_PREFIX.length);
  if (symmetric && first.startsWith(OLD_PREFIX) && second.startsWith(NEW_PREFIX)) return [first, second];

  const separator = rest.indexOf(` ${NEW_PREFIX}`);
  return separator < 0 ? null : [rest.slice(0, separator), rest.slice(separator + 1)];
}

function splitFileHeader(rest: string): readonly [string, string] | null {
  if (!rest.startsWith('"')) return splitBareHeader(rest);
  const first = readQuoted(rest, 0);
  const remainder = rest.slice(first.end).trimStart();
  return [first.value, remainder.startsWith('"') ? readQuoted(remainder, 0).value : remainder];
}

function openFile(rest: string): FileUnderRead {
  const paths = splitFileHeader(rest);
  return {
    oldPath: paths ? stripPrefix(paths[0], OLD_PREFIX) : null,
    newPath: paths ? stripPrefix(paths[1], NEW_PREFIX) : null,
    addedLines: [],
    removedLines: [],
    inHunk: false,
  };
}

function readBinaryNotice(file: FileUnderRead, notice: string): void {
  if (notice.startsWith(`${NO_FILE} and `)) file.oldPath = null;
  if (notice.endsWith(` and ${NO_FILE} differ`)) file.newPath = null;
}

/** The lines that can come before a file's first hunk; they apply only there, so a line of a hunk is never read as one. */
const HEADER_READERS: ReadonlyArray<readonly [prefix: string, read: HeaderReader]> = [
  ['--- ', (file, value) => { file.oldPath = readHeaderPath(value, OLD_PREFIX); }],
  ['+++ ', (file, value) => { file.newPath = readHeaderPath(value, NEW_PREFIX); }],
  ['rename from ', (file, value) => { file.oldPath = readHeaderPath(value, ''); }],
  ['rename to ', (file, value) => { file.newPath = readHeaderPath(value, ''); }],
  ['new file mode', (file) => { file.oldPath = null; }],
  ['deleted file mode', (file) => { file.newPath = null; }],
  ['Binary files ', readBinaryNotice],
  ['@@', (file) => { file.inHunk = true; }],
];

function readHeaderLine(file: FileUnderRead, line: string): void {
  const reader = HEADER_READERS.find(([prefix]) => line.startsWith(prefix));
  if (reader) reader[1](file, line.slice(reader[0].length));
}

/** Context lines, hunk headers and the "No newline at end of file" marker change nothing. */
function readHunkLine(file: FileUnderRead, line: string): void {
  if (line.startsWith('+')) file.addedLines.push(line.slice(1));
  else if (line.startsWith('-')) file.removedLines.push(line.slice(1));
}

function readLine(file: FileUnderRead, line: string): void {
  if (file.inHunk) readHunkLine(file, line);
  else readHeaderLine(file, line);
}

function finish(file: FileUnderRead): DiffFile {
  return { oldPath: file.oldPath, newPath: file.newPath, addedLines: file.addedLines, removedLines: file.removedLines };
}

/** Reads the output of `git diff` (best with `--no-renames`) into one entry per file, in order. */
export function parseUnifiedDiff(diff: string): readonly DiffFile[] {
  const files: DiffFile[] = [];
  let current: FileUnderRead | null = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith(FILE_HEADER)) {
      if (current) files.push(finish(current));
      current = openFile(line.slice(FILE_HEADER.length));
    } else if (current) {
      readLine(current, line);
    }
  }
  if (current) files.push(finish(current));
  return files;
}

export function touchedPaths(file: DiffFile): readonly string[] {
  return [...new Set([file.oldPath, file.newPath].filter((path): path is string => path !== null))];
}
