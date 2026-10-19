import type { Platform } from './applicationType';
import { parseMarkdownSections, sectionValue } from './markdownSections';

/** Each section of `.adw/project.md` as written; absent or empty ⇒ `null`. */
export interface DeviceSourceSections {
  readonly androidSystemImage: string | null;
  readonly androidDeviceProfile: string | null;
  readonly iosDeviceType: string | null;
  readonly iosRuntime: string | null;
}

/** What ADW creates the devices from: every section of a profile with platforms, set. */
export interface DeviceSource {
  /** An SDK package path, such as a `system-images;…` id. */
  readonly androidSystemImage: string;
  /** An `avdmanager` device id. */
  readonly androidDeviceProfile: string;
  /** A `simctl` device type identifier. */
  readonly iosDeviceType: string;
  /** A `simctl` runtime identifier. */
  readonly iosRuntime: string;
}

export type DeviceSourceResolution =
  | { readonly kind: 'not_required' }
  | { readonly kind: 'resolved'; readonly deviceSource: DeviceSource }
  | { readonly kind: 'missing'; readonly section: string; readonly message: string };

// The order is the order in which a missing section is reported.
export const DEVICE_SOURCE_SECTION_TITLES: Readonly<Record<keyof DeviceSourceSections, string>> = {
  androidSystemImage: 'Android System Image',
  androidDeviceProfile: 'Android Device Profile',
  iosDeviceType: 'iOS Device Type',
  iosRuntime: 'iOS Runtime',
};

export function parseDeviceSourceSections(projectMd: string): DeviceSourceSections {
  const sections = parseMarkdownSections(projectMd);
  const read = (key: keyof DeviceSourceSections): string | null => sectionValue(sections, DEVICE_SOURCE_SECTION_TITLES[key]);
  return {
    androidSystemImage: read('androidSystemImage'),
    androidDeviceProfile: read('androidDeviceProfile'),
    iosDeviceType: read('iosDeviceType'),
    iosRuntime: read('iosRuntime'),
  };
}

function missingSection(key: keyof DeviceSourceSections, platforms: readonly Platform[]): DeviceSourceResolution {
  const section = `## ${DEVICE_SOURCE_SECTION_TITLES[key]}`;
  return {
    kind: 'missing',
    section,
    message: `The device-source section "${section}" is missing or empty in .adw/project.md; ADW creates the devices the scenarios run on (${platforms.join(', ')}) from it`,
  };
}

/** A profile without platforms runs its scenarios on no device, so its sections are not read. */
export function resolveDeviceSource(sections: DeviceSourceSections, platforms: readonly Platform[]): DeviceSourceResolution {
  if (platforms.length === 0) return { kind: 'not_required' };

  const { androidSystemImage, androidDeviceProfile, iosDeviceType, iosRuntime } = sections;
  if (androidSystemImage === null) return missingSection('androidSystemImage', platforms);
  if (androidDeviceProfile === null) return missingSection('androidDeviceProfile', platforms);
  if (iosDeviceType === null) return missingSection('iosDeviceType', platforms);
  if (iosRuntime === null) return missingSection('iosRuntime', platforms);
  return { kind: 'resolved', deviceSource: { androidSystemImage, androidDeviceProfile, iosDeviceType, iosRuntime } };
}

export class DeviceSourceConfigError extends Error {
  readonly name = 'DeviceSourceConfigError';
  constructor(readonly section: string, message: string) {
    super(message);
  }
}
