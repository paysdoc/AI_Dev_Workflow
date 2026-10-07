import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readDeclaredDevServer } from '../declaredDevServer';

let checkout: string;

beforeEach(() => {
  checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-declared-server-'));
});

afterEach(() => {
  fs.rmSync(checkout, { recursive: true, force: true });
});

function writeCommandsMd(contents: string): void {
  fs.mkdirSync(path.join(checkout, '.adw'), { recursive: true });
  fs.writeFileSync(path.join(checkout, '.adw', 'commands.md'), contents);
}

describe('readDeclaredDevServer', () => {
  it('returns the declared command as written, with its port placeholder', () => {
    writeCommandsMd('## Install Dependencies\nbun install\n\n## Start Dev Server\nbun run dev --port {PORT}\n\n## Health Check Path\n/health\n');

    expect(readDeclaredDevServer(checkout)).toBe('bun run dev --port {PORT}');
  });

  it('returns nothing for N/A', () => {
    writeCommandsMd('## Start Dev Server\nN/A\n\n## Health Check Path\n/\n');

    expect(readDeclaredDevServer(checkout)).toBeNull();
  });

  it('returns nothing for an empty section', () => {
    writeCommandsMd('## Start Dev Server\n\n## Health Check Path\n/\n');

    expect(readDeclaredDevServer(checkout)).toBeNull();
  });

  it('returns nothing when the section is missing, although the parsed config would fill in `bun run dev`', () => {
    writeCommandsMd('## Install Dependencies\nbun install\n\n## Health Check Path\n/\n');

    expect(readDeclaredDevServer(checkout)).toBeNull();
  });

  it('returns nothing when the file is missing', () => {
    expect(readDeclaredDevServer(checkout)).toBeNull();
  });
});
