import type { Env } from './types.ts';

// Lifecycle phase order — phases not in this list sort last, alphabetically.
const PHASE_ORDER = ['plan', 'build', 'test', 'review', 'document'] as const;

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface ProjectListRow {
  readonly id: number;
  readonly slug: string;
  readonly name: string;
  readonly repo_url: string | null;
}

interface BreakdownRow {
  readonly model: string;
  readonly provider: string;
  readonly total_cost: number;
}

interface PhaseCostRow {
  readonly issue_number: number;
  readonly phase: string;
  readonly cost: number;
}

interface TokenUsageRow {
  readonly issue_number: number;
  readonly phase: string;
  readonly token_type: string;
  readonly token_count: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function notFoundResponse(): Response {
  return Response.json({ error: 'Project not found' }, { status: 404 });
}

async function projectExists(env: Env, projectId: number): Promise<boolean> {
  const row = await env.DB
    .prepare('SELECT id FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ id: number }>();
  return row !== null;
}

function sortPhases(a: string, b: string): number {
  const ai = PHASE_ORDER.indexOf(a as typeof PHASE_ORDER[number]);
  const bi = PHASE_ORDER.indexOf(b as typeof PHASE_ORDER[number]);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** GET /api/projects — returns all projects sorted by name ASC. */
export async function handleGetProjects(env: Env): Promise<Response> {
  const { results } = await env.DB
    .prepare('SELECT id, slug, name, repo_url FROM projects ORDER BY name ASC')
    .all<ProjectListRow>();

  return Response.json(results.map(r => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    repoUrl: r.repo_url,
  })));
}

/** GET /api/projects/:id/costs/breakdown — cost aggregated by model+provider, sorted by totalCost DESC. */
export async function handleGetCostBreakdown(projectId: string, env: Env): Promise<Response> {
  const id = parseInt(projectId, 10);
  if (isNaN(id)) return notFoundResponse();
  if (!(await projectExists(env, id))) return notFoundResponse();

  const { results } = await env.DB
    .prepare(`
      SELECT model, provider, SUM(COALESCE(reported_cost_usd, computed_cost_usd)) AS total_cost
      FROM cost_records
      WHERE project_id = ?
      GROUP BY model, provider
      ORDER BY total_cost DESC
    `)
    .bind(id)
    .all<BreakdownRow>();

  return Response.json(results.map(r => ({
    model: r.model,
    provider: r.provider,
    totalCost: r.total_cost,
  })));
}

/**
 * GET /api/projects/:id/costs/issues — per-issue costs with per-phase token
 * breakdowns, sorted by issueNumber ASC, phases in lifecycle order.
 *
 * Two queries are used to avoid the fan-out duplication that arises when
 * joining cost_records (one row per record) with token_usage (N rows per
 * record) and trying to SUM costs in the same GROUP BY as token types.
 */
export async function handleGetCostIssues(projectId: string, env: Env): Promise<Response> {
  const id = parseInt(projectId, 10);
  if (isNaN(id)) return notFoundResponse();
  if (!(await projectExists(env, id))) return notFoundResponse();

  const [phaseCosts, tokenUsage] = await Promise.all([
    env.DB
      .prepare(`
        SELECT issue_number, phase, SUM(COALESCE(reported_cost_usd, computed_cost_usd)) AS cost
        FROM cost_records
        WHERE project_id = ?
        GROUP BY issue_number, phase
        ORDER BY issue_number ASC
      `)
      .bind(id)
      .all<PhaseCostRow>(),
    env.DB
      .prepare(`
        SELECT cr.issue_number, cr.phase, tu.token_type, SUM(tu.count) AS token_count
        FROM token_usage tu
        JOIN cost_records cr ON tu.cost_record_id = cr.id
        WHERE cr.project_id = ?
        GROUP BY cr.issue_number, cr.phase, tu.token_type
      `)
      .bind(id)
      .all<TokenUsageRow>(),
  ]);

  // Build token lookup: issueNumber → phase → tokenType → count
  const tokenMap = new Map<number, Map<string, Map<string, number>>>();
  for (const row of tokenUsage.results) {
    if (!tokenMap.has(row.issue_number)) tokenMap.set(row.issue_number, new Map());
    const byPhase = tokenMap.get(row.issue_number)!;
    if (!byPhase.has(row.phase)) byPhase.set(row.phase, new Map());
    byPhase.get(row.phase)!.set(row.token_type, row.token_count);
  }

  // Group phase costs by issue number (already ordered by issue_number ASC)
  const issueMap = new Map<number, PhaseCostRow[]>();
  for (const row of phaseCosts.results) {
    if (!issueMap.has(row.issue_number)) issueMap.set(row.issue_number, []);
    issueMap.get(row.issue_number)!.push(row);
  }

  const issues = Array.from(issueMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([issueNumber, phases]) => {
      const totalCost = phases.reduce((sum, p) => sum + p.cost, 0);
      const sortedPhases = [...phases].sort((a, b) => sortPhases(a.phase, b.phase));
      return {
        issueNumber,
        totalCost,
        phases: sortedPhases.map(p => {
          const phaseTokens = tokenMap.get(issueNumber)?.get(p.phase) ?? new Map<string, number>();
          return {
            phase: p.phase,
            cost: p.cost,
            tokenUsage: Array.from(phaseTokens.entries()).map(([tokenType, count]) => ({
              tokenType,
              count,
            })),
          };
        }),
      };
    });

  return Response.json(issues);
}
