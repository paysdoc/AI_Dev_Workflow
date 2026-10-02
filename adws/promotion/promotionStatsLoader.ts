import type { PromotionStats } from './types.ts';
import type { LogLevel, LogSinceOptions } from '@paysdoc/devplatform/git';

const WINDOW_DAYS = 90;
const DIFF_FILE_HEADER = /^diff --git /m;
const SCENARIO_ADDITION = /^\+\s*Scenario:/gm;

export interface PromotionStatsLoaderDeps {
  gitLogSince: (opts: LogSinceOptions) => string;
  /** One merge time per promotion issue whose pull request merged — a promotion with several merged pull requests counts once. */
  listPromotionMergeDates: () => readonly Date[];
  now: () => Date;
  /** A plain directory: the library puts the pathspec unquoted into a shell command, so a glob would be shell-expanded and must not be used. */
  perIssueDir: string;
  log?: (msg: string, level?: LogLevel) => void;
}

function windowStart(now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - WINDOW_DAYS);
  return d;
}

function countPromotionsSince(deps: PromotionStatsLoaderDeps, start: Date): number {
  try {
    return deps.listPromotionMergeDates().filter(mergedAt => mergedAt.getTime() >= start.getTime()).length;
  } catch (err) {
    deps.log?.(`promotionStatsLoader: numerator query failed — ${err}`, 'warn');
    return 0;
  }
}

/** A section of `git log -p` output starts right after `diff --git `, so its first line is `a/<path> b/<path>`. */
function isFeatureSection(section: string): boolean {
  return section.split('\n', 1)[0].endsWith('.feature');
}

function countScenarioAdditions(patch: string): number {
  return patch
    .split(DIFF_FILE_HEADER)
    .slice(1)
    .filter(isFeatureSection)
    .reduce((total, section) => total + (section.match(SCENARIO_ADDITION) ?? []).length, 0);
}

function countPerIssueScenarioAdditions(deps: PromotionStatsLoaderDeps, isoSince: string): number {
  try {
    return countScenarioAdditions(deps.gitLogSince({ since: isoSince, patch: true, pathspec: deps.perIssueDir }));
  } catch (err) {
    deps.log?.(`promotionStatsLoader: denominator query failed — ${err}`, 'warn');
    return 0;
  }
}

export function loadPromotionStats(deps: PromotionStatsLoaderDeps): PromotionStats {
  const start = windowStart(deps.now());
  const isoSince = start.toISOString().slice(0, 10);
  return {
    promotedCount90d: countPromotionsSince(deps, start),
    totalPerIssueCount90d: countPerIssueScenarioAdditions(deps, isoSince),
  };
}
