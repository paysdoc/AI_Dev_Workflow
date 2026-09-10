/**
 * ADW's consumer-side provider-config parser — reads `.adw/providers.md` in a
 * workspace directory. The PRD says the extractable library never reads
 * consumer config files, which is why this lives in `adws/core/` rather than
 * in the provider package. Moved out of the now-deleted `adws/providers/repoContext.ts`
 * (#819); its output changed from `Platform` to per-port forge names and its
 * re-export shim there dropped when that file was deleted (#823).
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  CODE_HOST_FORGES,
  ISSUE_TRACKER_FORGES,
  isCodeHostForge,
  isIssueTrackerForge,
  type CodeHostForge,
  type IssueTrackerForge,
} from '../providers/forgeProviders';

/** Provider forge configuration read from `.adw/providers.md`. */
export interface ProviderConfig {
  codeHost: CodeHostForge;
  codeHostUrl?: string;
  issueTracker: IssueTrackerForge;
  issueTrackerUrl?: string;
  issueTrackerProjectKey?: string;
}

/**
 * Parses a code-host forge name. Case-insensitive. Throws, naming the
 * section and the value, when the name is outside the code-host union.
 */
export function parseCodeHostForge(value: string, section: string): CodeHostForge {
  const trimmed = value.trim().toLowerCase();
  if (!isCodeHostForge(trimmed)) {
    throw new Error(
      `Unsupported code host "${value.trim()}" in ${section} section of .adw/providers.md (expected one of: ${CODE_HOST_FORGES.join(', ')})`,
    );
  }
  return trimmed;
}

/**
 * Parses an issue-tracker forge name. Case-insensitive. Throws, naming the
 * section and the value, when the name is outside the issue-tracker union.
 */
export function parseIssueTrackerForge(value: string, section: string): IssueTrackerForge {
  const trimmed = value.trim().toLowerCase();
  if (!isIssueTrackerForge(trimmed)) {
    throw new Error(
      `Unsupported issue tracker "${value.trim()}" in ${section} section of .adw/providers.md (expected one of: ${ISSUE_TRACKER_FORGES.join(', ')})`,
    );
  }
  return trimmed;
}

/**
 * Loads provider configuration from `.adw/providers.md` in the working directory.
 * Returns GitHub defaults when the file is absent or sections are missing.
 */
export function loadProviderConfig(cwd: string): ProviderConfig {
  const configPath = join(cwd, '.adw', 'providers.md');
  const defaults: ProviderConfig = {
    codeHost: 'github',
    issueTracker: 'github',
  };

  if (!existsSync(configPath)) {
    return defaults;
  }

  const content = readFileSync(configPath, 'utf-8');
  const config = { ...defaults };

  const codeHostMatch = content.match(/^## Code Host\s*\n+(.+)/m);
  if (codeHostMatch) {
    config.codeHost = parseCodeHostForge(codeHostMatch[1], '## Code Host');
  }

  const issueTrackerMatch = content.match(/^## Issue Tracker\s*\n+(.+)/m);
  if (issueTrackerMatch) {
    config.issueTracker = parseIssueTrackerForge(
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
