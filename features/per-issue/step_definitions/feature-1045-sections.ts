/**
 * The words the feature-1045 scenarios use for the four device-source sections of ".adw/project.md": each is written as the
 * heading it has there ("## iOS Runtime"). A heading that is none of the four is a mistake in the scenario, which would
 * otherwise leave a section out that was never there, and pass.
 */

import assert from 'assert';
import type { DataTable } from '@cucumber/cucumber';

import type { DeviceSourceSections } from '../../../adws/core/deviceSourceConfig.ts';

// Written from the issue, not looked up in the parser's `DEVICE_SOURCE_SECTION_TITLES`, so a section read into the
// wrong field fails the scenario.
const FIELD_OF_SECTION: ReadonlyMap<string, keyof DeviceSourceSections> = new Map([
  ['## Android System Image', 'androidSystemImage'],
  ['## Android Device Profile', 'androidDeviceProfile'],
  ['## iOS Device Type', 'iosDeviceType'],
  ['## iOS Runtime', 'iosRuntime'],
]);

const HEADING_MARK = '## ';

export function assertDeviceSourceSection(section: string): void {
  const known = [...FIELD_OF_SECTION.keys()];
  assert.ok(known.includes(section), `Expected one of the device-source sections ${known.join(', ')}, but the scenario names "${section}"`);
}

/** The heading without its mark: the title the fixture writes the section under. */
export function titleOf(section: string): string {
  assertDeviceSourceSection(section);
  return section.slice(HEADING_MARK.length);
}

/** The field of the project configuration the section is read into. */
export function keyOf(section: string): keyof DeviceSourceSections {
  assertDeviceSourceSection(section);
  const key = FIELD_OF_SECTION.get(section);
  assert.ok(key, `Expected "${section}" to be read into a field of the project configuration`);
  return key;
}

/** The values a table with a "section" and a "value" column names, by field; a section it does not name has none. */
export function valuesOf(table: DataTable): DeviceSourceSections {
  const named = new Map(table.hashes().map(({ section, value }): [keyof DeviceSourceSections, string] => [keyOf(section), value]));
  return {
    androidSystemImage: named.get('androidSystemImage') ?? null,
    androidDeviceProfile: named.get('androidDeviceProfile') ?? null,
    iosDeviceType: named.get('iosDeviceType') ?? null,
    iosRuntime: named.get('iosRuntime') ?? null,
  };
}
