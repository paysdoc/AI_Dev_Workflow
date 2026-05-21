import type { PromotionStats } from './types.ts';

export interface PromotionStatsLoaderDeps {
  runGit: (args: string, options: { cwd: string }) => string;
  now: () => Date;
  perIssueGlob: string;
  cwd: string;
  log?: (msg: string, level?: string) => void;
}

function isoDateMinus90Days(now: Date): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
}

function countPromotionCommits(deps: PromotionStatsLoaderDeps, isoSince: string): number {
  try {
    const out = deps.runGit(
      `log --since="${isoSince}" --grep="^regression-promotion:" --no-merges --oneline`,
      { cwd: deps.cwd },
    );
    return out.split('\n').filter(l => l.trim().length > 0).length;
  } catch (err) {
    deps.log?.(`promotionStatsLoader: numerator query failed — ${err}`, 'warn');
    return 0;
  }
}

function countPerIssueScenarioAdditions(deps: PromotionStatsLoaderDeps, isoSince: string): number {
  try {
    const out = deps.runGit(
      `log --since="${isoSince}" --no-merges -p -- ${deps.perIssueGlob}`,
      { cwd: deps.cwd },
    );
    return (out.match(/^\+\s*Scenario:/gm) ?? []).length;
  } catch (err) {
    deps.log?.(`promotionStatsLoader: denominator query failed — ${err}`, 'warn');
    return 0;
  }
}

export function loadPromotionStats(deps: PromotionStatsLoaderDeps): PromotionStats {
  const isoSince = isoDateMinus90Days(deps.now());
  const promotedCount90d = countPromotionCommits(deps, isoSince);
  const totalPerIssueCount90d = countPerIssueScenarioAdditions(deps, isoSince);
  return { promotedCount90d, totalPerIssueCount90d };
}
