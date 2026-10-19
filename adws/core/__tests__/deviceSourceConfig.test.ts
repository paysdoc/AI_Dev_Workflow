import { describe, it, expect } from 'vitest';
import {
  DEVICE_SOURCE_SECTION_TITLES,
  DeviceSourceConfigError,
  parseDeviceSourceSections,
  resolveDeviceSource,
  type DeviceSource,
  type DeviceSourceSections,
} from '../deviceSourceConfig';
import { APPLICATION_TYPE_PROFILES } from '../applicationType';

const EVERY_SECTION: DeviceSource = {
  androidSystemImage: 'system-images;android-35;google_apis;arm64-v8a',
  androidDeviceProfile: 'pixel_8',
  iosDeviceType: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
  iosRuntime: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
};

const NO_SECTION: DeviceSourceSections = {
  androidSystemImage: null,
  androidDeviceProfile: null,
  iosDeviceType: null,
  iosRuntime: null,
};

const SECTIONS = Object.keys(DEVICE_SOURCE_SECTION_TITLES) as Array<keyof DeviceSourceSections>;

const MOBILE = APPLICATION_TYPE_PROFILES['mobile:kotlincm'];

/** A `project.md` that holds the given bodies under their `## <title>` headings, beside the sections of a real one. */
function projectMdWith(bodies: Partial<Record<keyof DeviceSourceSections, string>>): string {
  const deviceSourceSections = SECTIONS.flatMap((key) => {
    const body = bodies[key];
    return body === undefined ? [] : [`## ${DEVICE_SOURCE_SECTION_TITLES[key]}\n${body}\n`];
  });
  return ['# ADW Project Configuration\n', '## Application Type\nmobile:kotlincm\n', ...deviceSourceSections].join('\n');
}

describe('DEVICE_SOURCE_SECTION_TITLES — the headings the owner writes', () => {
  it('holds the four headings, in the order a missing section is reported', () => {
    expect(Object.values(DEVICE_SOURCE_SECTION_TITLES)).toEqual([
      'Android System Image',
      'Android Device Profile',
      'iOS Device Type',
      'iOS Runtime',
    ]);
  });
});

describe('parseDeviceSourceSections — each section says what it says, and nothing is assumed', () => {
  it('reads all four values as written, keeping their case and their ; . - _', () => {
    expect(parseDeviceSourceSections(projectMdWith(EVERY_SECTION))).toEqual({
      androidSystemImage: 'system-images;android-35;google_apis;arm64-v8a',
      androidDeviceProfile: 'pixel_8',
      iosDeviceType: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
      iosRuntime: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
    });
  });

  it('reads an empty project.md as no section', () => {
    expect(parseDeviceSourceSections('')).toEqual(NO_SECTION);
  });

  it.each(SECTIONS)('reads %s as null from a project without its section, and still reads the other three', (missing) => {
    const present = Object.fromEntries(SECTIONS.filter((key) => key !== missing).map((key) => [key, EVERY_SECTION[key]]));

    expect(parseDeviceSourceSections(projectMdWith(present))).toEqual({ ...EVERY_SECTION, [missing]: null });
  });

  it('reads a heading with an empty body, followed by another heading, as null', () => {
    const projectMd = '## Android Device Profile\n\n## iOS Device Type\ncom.apple.CoreSimulator.SimDeviceType.iPhone-16\n';

    expect(parseDeviceSourceSections(projectMd)).toEqual({ ...NO_SECTION, iosDeviceType: EVERY_SECTION.iosDeviceType });
  });

  it('reads a body of blank lines only as null', () => {
    expect(parseDeviceSourceSections(projectMdWith({ iosRuntime: '\n   \n\n' }))).toEqual(NO_SECTION);
  });

  it('reads a body that holds only an HTML comment as null', () => {
    expect(parseDeviceSourceSections(projectMdWith({ androidSystemImage: '<!-- an SDK package path -->' }))).toEqual(NO_SECTION);
  });

  describe('HTML comments', () => {
    const PLACEMENTS: Array<{ placement: string; body: (value: string) => string }> = [
      { placement: 'on the line above the value', body: (v) => `<!-- default written by adw_init -->\n${v}` },
      { placement: 'after the value on its line', body: (v) => `${v} <!-- default written by adw_init -->` },
      { placement: 'on the line below the value', body: (v) => `${v}\n<!-- default written by adw_init -->` },
      { placement: 'across several lines above the value', body: (v) => `<!-- default written by adw_init.\n     Name the image you want.\n-->\n${v}` },
    ];

    for (const { placement, body } of PLACEMENTS) {
      it(`strips a comment ${placement} from every section value`, () => {
        const bodies = Object.fromEntries(SECTIONS.map((key) => [key, body(EVERY_SECTION[key])]));

        expect(parseDeviceSourceSections(projectMdWith(bodies))).toEqual(EVERY_SECTION);
      });
    }
  });

  it('trims the spaces and blank lines around a value', () => {
    expect(parseDeviceSourceSections(projectMdWith({ androidDeviceProfile: '\n\n   pixel_8   \n\n' }))).toEqual({
      ...NO_SECTION,
      androidDeviceProfile: 'pixel_8',
    });
  });

  it('finds each heading whatever its case', () => {
    const projectMd = [
      '## ANDROID SYSTEM IMAGE',
      EVERY_SECTION.androidSystemImage,
      '## android device profile',
      EVERY_SECTION.androidDeviceProfile,
      '## iOS DEVICE TYPE',
      EVERY_SECTION.iosDeviceType,
      '## IOS RUNTIME',
      EVERY_SECTION.iosRuntime,
    ].join('\n');

    expect(parseDeviceSourceSections(projectMd)).toEqual(EVERY_SECTION);
  });

  it('lets no other section of a real project.md leak into a value', () => {
    const projectMd = [
      '# ADW Project Configuration',
      '',
      '## Project Overview',
      'A Kotlin Compose Multiplatform application for Android and iPhone.',
      '',
      '## Application Type',
      'mobile:kotlincm',
      '',
      '## Android System Image',
      EVERY_SECTION.androidSystemImage,
      '',
      '## Framework Notes',
      'Compose, Gradle',
    ].join('\n');

    expect(parseDeviceSourceSections(projectMd)).toEqual({ ...NO_SECTION, androidSystemImage: EVERY_SECTION.androidSystemImage });
  });

  it('reads a ### heading as no section, since only ## headings open one', () => {
    const projectMd = '## Application Type\nmobile:kotlincm\n\n### iOS Runtime\ncom.apple.CoreSimulator.SimRuntime.iOS-18-2\n';

    expect(parseDeviceSourceSections(projectMd)).toEqual(NO_SECTION);
  });

  it('reads the last of two sections of the same heading, as for every other .adw/ section', () => {
    const projectMd = '## iOS Runtime\ncom.apple.CoreSimulator.SimRuntime.iOS-17-5\n\n## iOS Runtime\ncom.apple.CoreSimulator.SimRuntime.iOS-18-2\n';

    expect(parseDeviceSourceSections(projectMd).iosRuntime).toBe(EVERY_SECTION.iosRuntime);
  });
});

describe('resolveDeviceSource — a profile with platforms needs every section', () => {
  describe.each([
    ['cli', APPLICATION_TYPE_PROFILES.cli],
    ['web', APPLICATION_TYPE_PROFILES.web],
  ])('a %s profile, which declares no platform', (_type, profile) => {
    it('needs no device source when no section is set', () => {
      expect(resolveDeviceSource(NO_SECTION, profile.platforms)).toEqual({ kind: 'not_required' });
    });

    it('ignores the sections when all four are set', () => {
      expect(resolveDeviceSource(EVERY_SECTION, profile.platforms)).toEqual({ kind: 'not_required' });
    });
  });

  it('resolves to a device source that carries each section in its field', () => {
    expect(resolveDeviceSource(EVERY_SECTION, MOBILE.platforms)).toEqual({
      kind: 'resolved',
      deviceSource: {
        androidSystemImage: 'system-images;android-35;google_apis;arm64-v8a',
        androidDeviceProfile: 'pixel_8',
        iosDeviceType: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
        iosRuntime: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
      },
    });
  });

  it.each(SECTIONS)('names its heading when %s is the one section that is missing', (missing) => {
    const resolution = resolveDeviceSource({ ...EVERY_SECTION, [missing]: null }, MOBILE.platforms);
    const heading = `## ${DEVICE_SOURCE_SECTION_TITLES[missing]}`;

    expect(resolution).toMatchObject({ kind: 'missing', section: heading });
    expect(resolution.kind === 'missing' && resolution.message).toContain(`"${heading}"`);
  });

  it('names only the first missing section, in the order of the four, when several are missing', () => {
    const resolution = resolveDeviceSource({ ...EVERY_SECTION, iosDeviceType: null, androidDeviceProfile: null }, MOBILE.platforms);

    expect(resolution).toMatchObject({ kind: 'missing', section: '## Android Device Profile' });
    expect(resolution.kind === 'missing' && resolution.message).not.toContain('iOS Device Type');
  });

  it('names "## Android System Image" when all four are missing', () => {
    expect(resolveDeviceSource(NO_SECTION, MOBILE.platforms)).toMatchObject({ kind: 'missing', section: '## Android System Image' });
  });

  it('words the message for a missing iOS runtime as pinned: it names the section, the file and the platforms', () => {
    expect(resolveDeviceSource({ ...EVERY_SECTION, iosRuntime: null }, MOBILE.platforms)).toEqual({
      kind: 'missing',
      section: '## iOS Runtime',
      message:
        'The device-source section "## iOS Runtime" is missing or empty in .adw/project.md; ADW creates the devices the scenarios run on (android, ios) from it',
    });
  });
});

describe('DeviceSourceConfigError', () => {
  it('is an Error that carries the section it names, under its own name', () => {
    const error = new DeviceSourceConfigError('## iOS Runtime', 'the message');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DeviceSourceConfigError');
    expect(error.section).toBe('## iOS Runtime');
    expect(error.message).toBe('the message');
  });
});
