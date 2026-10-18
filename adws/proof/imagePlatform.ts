/**
 * Pure. The platform of a per-issue image is the first directory of its path under the harvest root. That is the directory the
 * repository's screenshot hook chose, because a descriptor run's `ADW_PROOF_DIR` is the harvest root itself: no tag or case
 * directory sits between the root and the platform.
 */

import type { Platform } from '../core/applicationType';
import type { PerIssueImage, ScenarioPlatformCoverage } from './types';

/** Null: the image is unattributed, at the root or under a directory that names no platform of the profile. */
export function platformOfImage(relPath: string, platforms: readonly Platform[]): Platform | null {
  const [directory, ...rest] = relPath.split('/');
  if (rest.length === 0) return null;
  return platforms.find(platform => platform === directory) ?? null;
}

function coverageOf(scenario: string, images: readonly PerIssueImage[], platforms: readonly Platform[]): ScenarioPlatformCoverage {
  const shown = new Set(images.filter(image => image.scenario === scenario).map(image => image.platform));
  return { scenario, present: platforms.filter(platform => shown.has(platform)), missing: platforms.filter(platform => !shown.has(platform)) };
}

/** One entry per scenario that has an image, in the order of its first image. */
export function scenarioPlatformCoverage(images: readonly PerIssueImage[], platforms: readonly Platform[]): ScenarioPlatformCoverage[] {
  return [...new Set(images.map(image => image.scenario))].map(scenario => coverageOf(scenario, images, platforms));
}
