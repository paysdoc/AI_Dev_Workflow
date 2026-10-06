import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as ts from 'typescript';
import {
  APPLICATION_TYPE_PROFILES,
  EvidenceKind,
  RunnerMode,
  describeApplicationProfile,
  resolveApplicationType,
  type ApplicationProfile,
} from '../applicationType';
import { ParkReason } from '../../forge/parkComment';

const FAKE: ApplicationProfile = {
  runnerMode: RunnerMode.Descriptor,
  evidenceKinds: [EvidenceKind.PerIssueImages],
  reviewGuidanceSection: 'Desktop applications',
};

function parkFor(found: string | null) {
  return { kind: 'park', evidence: { reason: ParkReason.MissingApplicationType, found } };
}

describe('resolveApplicationType — the two types ADW knows', () => {
  it('maps cli to the descriptor runner and asks for no image', () => {
    expect(resolveApplicationType('cli')).toEqual({
      kind: 'known',
      profile: { runnerMode: RunnerMode.Descriptor, evidenceKinds: [], reviewGuidanceSection: 'CLI applications' },
    });
  });

  it('maps web to the ADW Playwright project and asks for per-issue images', () => {
    expect(resolveApplicationType('web')).toEqual({
      kind: 'known',
      profile: {
        runnerMode: RunnerMode.AdwPlaywright,
        evidenceKinds: [EvidenceKind.PerIssueImages],
        reviewGuidanceSection: 'Web applications',
      },
    });
  });

  it.each([
    [' Web ', 'web'],
    ['CLI', 'cli'],
    ['web\n', 'web'],
    ['\tCli\r\n', 'cli'],
  ] as const)('reads %j as %s: the value is trimmed and case-insensitive', (declared, type) => {
    expect(resolveApplicationType(declared)).toEqual(resolveApplicationType(type));
    expect(resolveApplicationType(declared).kind).toBe('known');
  });

  it('gives cli and web a review guidance section each, and no two the same', () => {
    const sections = Object.values(APPLICATION_TYPE_PROFILES).map(profile => profile.reviewGuidanceSection);

    expect(new Set(sections).size).toBe(sections.length);
    sections.forEach(section => expect(section.trim()).not.toBe(''));
  });

  it('holds exactly the two types of the decision record', () => {
    expect(Object.keys(APPLICATION_TYPE_PROFILES).sort()).toEqual(['cli', 'web']);
  });
});

describe('resolveApplicationType — what parks the issue', () => {
  it.each([[null], [''], ['   '], ['\n\t ']])('parks a missing type (%j) and records that none was found', (declared) => {
    expect(resolveApplicationType(declared)).toEqual(parkFor(null));
  });

  it.each(['desktop', 'cli or web', 'api', 'web app', 'CLI tool'])('parks the unknown type %j and records it as it was written', (declared) => {
    expect(resolveApplicationType(declared)).toEqual(parkFor(declared));
  });

  it('never lowercases the value it records', () => {
    expect(resolveApplicationType('Desktop')).toEqual(parkFor('Desktop'));
  });

  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf'])('parks %j, a key the table inherits but does not hold', (declared) => {
    expect(resolveApplicationType(declared)).toEqual(parkFor(declared));
  });

  it('decides the park and its reason itself, so that a caller only carries it out', () => {
    const resolution = resolveApplicationType('desktop');

    expect(resolution.kind === 'park' && resolution.evidence.reason).toBe(ParkReason.MissingApplicationType);
  });
});

describe('resolveApplicationType — a third type reaches a consumer through the table alone', () => {
  const extended = { ...APPLICATION_TYPE_PROFILES, desktop: FAKE };

  it('resolves the extra type to its own profile', () => {
    expect(resolveApplicationType('desktop', extended)).toEqual({ kind: 'known', profile: FAKE });
  });

  it('parks the same type when the table does not hold it', () => {
    expect(resolveApplicationType('desktop')).toEqual(parkFor('desktop'));
  });

  it('still resolves cli and web beside it', () => {
    expect(resolveApplicationType('cli', extended)).toEqual(resolveApplicationType('cli'));
    expect(resolveApplicationType('web', extended)).toEqual(resolveApplicationType('web'));
  });

  it('still parks an inherited key', () => {
    expect(resolveApplicationType('constructor', extended)).toEqual(parkFor('constructor'));
  });
});

describe('describeApplicationProfile', () => {
  it('names the runner of .adw/scenarios.md and no images for cli', () => {
    const description = describeApplicationProfile(APPLICATION_TYPE_PROFILES.cli);

    expect(description).toContain('.adw/scenarios.md');
    expect(description).toContain('no images');
  });

  it('names the ADW Playwright project in features/ and per-issue scenario images for web', () => {
    const description = describeApplicationProfile(APPLICATION_TYPE_PROFILES.web);

    expect(description).toContain('Playwright project');
    expect(description).toContain('features/');
    expect(description).toContain('per-issue scenario images');
  });

  it('describes a profile from its fields alone, with no type name in it', () => {
    const description = describeApplicationProfile(FAKE);

    expect(description).toContain('.adw/scenarios.md');
    expect(description).toContain('per-issue scenario images');
    expect(description.toLowerCase()).not.toContain('desktop');
  });

  it('stays on one line', () => {
    Object.values({ ...APPLICATION_TYPE_PROFILES, desktop: FAKE }).forEach((profile) => {
      expect(describeApplicationProfile(profile)).not.toMatch(/[\r\n]/);
    });
  });
});

describe('every consumer reads the mapping, never the type', () => {
  const ADWS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const MAY_NAME_THE_TYPE = ['core/projectConfig.ts', 'phases/applicationTypeGate.ts'];
  const SKIPPED_DIRECTORIES = new Set(['__tests__', 'node_modules']);
  const TYPE_NAME = 'applicationType';

  function sourceFilesUnder(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : sourceFilesUnder(entryPath);
      return /\.tsx?$/.test(entry.name) ? [entryPath] : [];
    });
  }

  // An identifier, or a string that is exactly the name (`config['applicationType']`). A module specifier such as
  // './applicationType' is neither: importing the mapping is how a consumer is meant to read it.
  function isTypeName(node: ts.Node): boolean {
    if (ts.isIdentifier(node)) return node.text === TYPE_NAME;
    return ts.isStringLiteralLike(node) && node.text === TYPE_NAME;
  }

  function namesTheType(node: ts.Node): boolean {
    return isTypeName(node) || ts.forEachChild(node, namesTheType) === true;
  }

  function sourcesNamingTheType(): string[] {
    return sourceFilesUnder(ADWS_DIR)
      .filter(file => namesTheType(ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest)))
      .map(file => path.relative(ADWS_DIR, file).split(path.sep).join('/'))
      .sort();
  }

  it('names applicationType in no module but the config parser and the gate', () => {
    const offenders = sourcesNamingTheType().filter(file => !MAY_NAME_THE_TYPE.includes(file));

    expect(
      offenders,
      `adws/${offenders.join(', adws/')} name applicationType: read the mapping instead (requireApplicationProfile, or resolveApplicationType where the type is declared)`,
    ).toEqual([]);
  });

  it('finds the name in both of those modules, so that the walk does not pass by finding nothing', () => {
    expect(sourcesNamingTheType()).toEqual([...MAY_NAME_THE_TYPE].sort());
  });
});
