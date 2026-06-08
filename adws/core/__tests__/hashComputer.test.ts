import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import * as path from 'path';
import { computeFrameworkHash, ADW_INIT_RELATIVE_PATH } from '../hashComputer';
import type { HashComputerDeps } from '../hashComputer';

const ROOT = '/fake-root';

/** Build an in-memory HashComputerDeps from a map of absolute path → Buffer. */
function makeMemDeps(files: Map<string, Buffer>): HashComputerDeps {
  return {
    readFile: (filePath: string): Buffer => {
      const buf = files.get(filePath);
      if (buf === undefined) {
        const err = Object.assign(new Error(`ENOENT: no such file or directory: '${filePath}'`), {
          code: 'ENOENT',
        });
        throw err;
      }
      return buf;
    },
  };
}

/** Build an adw_init.md content string with the given hashInputs list. */
function makeAdwInit(hashInputs: string[]): Buffer {
  const list = hashInputs.map((p) => `  - ${p}`).join('\n');
  const content = `---\ntarget: false\nhashInputs:\n${list}\n---\n# content\n`;
  return Buffer.from(content, 'utf-8');
}

/** Absolute path for a relative path under ROOT. */
function abs(relPath: string): string {
  return path.join(ROOT, relPath);
}

// ── §1 Normal path / known digest ─────────────────────────────────────────

describe('normal path', () => {
  it('returns a 64-char lowercase hex SHA256 digest matching independently computed value', () => {
    const alphaBytes = Buffer.from('alpha-content-537', 'utf-8');
    const betaBytes = Buffer.from('beta-content-537', 'utf-8');

    const files = new Map<string, Buffer>([
      [abs(ADW_INIT_RELATIVE_PATH), makeAdwInit(['inputs/alpha.txt', 'inputs/beta.txt'])],
      [abs('inputs/alpha.txt'), alphaBytes],
      [abs('inputs/beta.txt'), betaBytes],
    ]);
    const deps = makeMemDeps(files);

    const result = computeFrameworkHash(ROOT, deps);

    // Independently compute: sorted order is alpha < beta
    const expected = createHash('sha256')
      .update(alphaBytes)
      .update(betaBytes)
      .digest('hex');

    expect(result).toBe(expected);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── §2 Reorder stability ───────────────────────────────────────────────────

describe('reorder stability', () => {
  it('produces the same digest regardless of hashInputs list order', () => {
    const alphaBytes = Buffer.from('alpha-bytes', 'utf-8');
    const betaBytes = Buffer.from('beta-bytes', 'utf-8');

    const filesAB = new Map<string, Buffer>([
      [abs(ADW_INIT_RELATIVE_PATH), makeAdwInit(['inputs/alpha.txt', 'inputs/beta.txt'])],
      [abs('inputs/alpha.txt'), alphaBytes],
      [abs('inputs/beta.txt'), betaBytes],
    ]);
    const filesBA = new Map<string, Buffer>([
      [abs(ADW_INIT_RELATIVE_PATH), makeAdwInit(['inputs/beta.txt', 'inputs/alpha.txt'])],
      [abs('inputs/alpha.txt'), alphaBytes],
      [abs('inputs/beta.txt'), betaBytes],
    ]);

    const hashAB = computeFrameworkHash(ROOT, makeMemDeps(filesAB));
    const hashBA = computeFrameworkHash(ROOT, makeMemDeps(filesBA));

    expect(hashAB).toBe(hashBA);
  });
});

// ── §3 Byte-change sensitivity ─────────────────────────────────────────────

describe('byte-change sensitivity', () => {
  function baseFiles(): Map<string, Buffer> {
    return new Map<string, Buffer>([
      [abs(ADW_INIT_RELATIVE_PATH), makeAdwInit(['inputs/alpha.txt', 'inputs/beta.txt'])],
      [abs('inputs/alpha.txt'), Buffer.from('alpha-bytes', 'utf-8')],
      [abs('inputs/beta.txt'), Buffer.from('beta-bytes', 'utf-8')],
    ]);
  }

  it('changing one byte in the first declared file changes the digest', () => {
    const original = computeFrameworkHash(ROOT, makeMemDeps(baseFiles()));

    const modified = baseFiles();
    modified.set(abs('inputs/alpha.txt'), Buffer.from('ALPHA-bytes', 'utf-8'));

    expect(computeFrameworkHash(ROOT, makeMemDeps(modified))).not.toBe(original);
  });

  it('changing one byte in the second declared file changes the digest', () => {
    const original = computeFrameworkHash(ROOT, makeMemDeps(baseFiles()));

    const modified = baseFiles();
    modified.set(abs('inputs/beta.txt'), Buffer.from('BETA-bytes', 'utf-8'));

    expect(computeFrameworkHash(ROOT, makeMemDeps(modified))).not.toBe(original);
  });
});

// ── §4 Missing hashInputs frontmatter ─────────────────────────────────────

describe('missing hashInputs frontmatter', () => {
  it('throws when frontmatter has no hashInputs key', () => {
    const files = new Map<string, Buffer>([
      [
        abs(ADW_INIT_RELATIVE_PATH),
        Buffer.from('---\ntarget: false\n---\n# no hashInputs\n', 'utf-8'),
      ],
    ]);
    expect(() => computeFrameworkHash(ROOT, makeMemDeps(files))).toThrow(/hashInputs/);
  });

  it('throws when file has no frontmatter at all', () => {
    const files = new Map<string, Buffer>([
      [abs(ADW_INIT_RELATIVE_PATH), Buffer.from('# no frontmatter\n', 'utf-8')],
    ]);
    expect(() => computeFrameworkHash(ROOT, makeMemDeps(files))).toThrow(/hashInputs/);
  });

  it('throws when hashInputs list is empty', () => {
    const files = new Map<string, Buffer>([
      [
        abs(ADW_INIT_RELATIVE_PATH),
        Buffer.from('---\ntarget: false\nhashInputs:\n---\n# empty list\n', 'utf-8'),
      ],
    ]);
    expect(() => computeFrameworkHash(ROOT, makeMemDeps(files))).toThrow(/hashInputs/);
  });
});

// ── §5 Missing referenced file ─────────────────────────────────────────────

describe('missing referenced file', () => {
  it('throws naming the missing relative path when a declared file does not resolve', () => {
    const files = new Map<string, Buffer>([
      [abs(ADW_INIT_RELATIVE_PATH), makeAdwInit(['inputs/present.txt', 'inputs/missing.txt'])],
      [abs('inputs/present.txt'), Buffer.from('present', 'utf-8')],
    ]);
    expect(() => computeFrameworkHash(ROOT, makeMemDeps(files))).toThrow('inputs/missing.txt');
  });
});

// ── §6 Missing adw_init.md ─────────────────────────────────────────────────

describe('missing adw_init.md', () => {
  it('throws a clear error mentioning adw_init.md when the spec file is absent', () => {
    const files = new Map<string, Buffer>();
    expect(() => computeFrameworkHash(ROOT, makeMemDeps(files))).toThrow('adw_init.md');
  });
});

// ── §7 Real-repo smoke test ────────────────────────────────────────────────

describe('real-repo smoke test', () => {
  it('returns a stable 64-char hex digest for the live ADW checkout', () => {
    const repoRoot = path.resolve(__dirname, '../../../');

    const first = computeFrameworkHash(repoRoot);
    const second = computeFrameworkHash(repoRoot);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(second);
  });
});
