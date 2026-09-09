/**
 * ADW's consumer-side provider-config parser — reads `.adw/providers.md` in a
 * workspace directory. The PRD says the extractable library never reads
 * consumer config files, which is why this lives in `adws/core/` (#823's
 * designated home for it) rather than in the provider package. Moved
 * verbatim out of `adws/providers/repoContext.ts` (#819) to keep that file
 * under the 300-line cap; re-exported there so no importer changed.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Platform } from '../providers/types';

/** Provider platform configuration read from `.adw/providers.md`. */
export interface ProviderConfig {
  codeHost: Platform;
  codeHostUrl?: string;
  issueTracker: Platform;
  issueTrackerUrl?: string;
  issueTrackerProjectKey?: string;
}

const PLATFORM_VALUES = new Map<string, Platform>(
  Object.values(Platform).map((v) => [v.toLowerCase(), v]),
);

/**
 * Parses a platform string to its Platform enum value.
 * Case-insensitive. Throws on unknown values.
 */
export function parsePlatform(value: string, section: string): Platform {
  const trimmed = value.trim().toLowerCase();
  const platform = PLATFORM_VALUES.get(trimmed);
  if (!platform) {
    throw new Error(
      `Unknown platform "${value.trim()}" in ${section} section of .adw/providers.md`,
    );
  }
  return platform;
}

/**
 * Loads provider configuration from `.adw/providers.md` in the working directory.
 * Returns GitHub defaults when the file is absent or sections are missing.
 */
export function loadProviderConfig(cwd: string): ProviderConfig {
  const configPath = join(cwd, '.adw', 'providers.md');
  const defaults: ProviderConfig = {
    codeHost: Platform.GitHub,
    issueTracker: Platform.GitHub,
  };

  if (!existsSync(configPath)) {
    return defaults;
  }

  const content = readFileSync(configPath, 'utf-8');
  const config = { ...defaults };

  const codeHostMatch = content.match(/^## Code Host\s*\n+(.+)/m);
  if (codeHostMatch) {
    config.codeHost = parsePlatform(codeHostMatch[1], '## Code Host');
  }

  const issueTrackerMatch = content.match(/^## Issue Tracker\s*\n+(.+)/m);
  if (issueTrackerMatch) {
    config.issueTracker = parsePlatform(
      issueTrackerMatch[1],
      '## Issue Tracker',
    );
  }

  const codeHostUrlMatch = content.match(/^## Code Host URL\s*\n+(.+)/m);
  if (codeHostUrlMatch) {
    config.codeHostUrl = codeHostUrlMatch[1].trim();
  }

  const issueTrackerUrlMatch = content.match(/^## Issue Tracker URL\s*\n+(.+)/m);
  if (issueTrackerUrlMatch) {
    config.issueTrackerUrl = issueTrackerUrlMatch[1].trim();
  }

  const projectKeyMatch = content.match(/^## Issue Tracker Project Key\s*\n+(.+)/m);
  if (projectKeyMatch) {
    config.issueTrackerProjectKey = projectKeyMatch[1].trim();
  }

  return config;
}
