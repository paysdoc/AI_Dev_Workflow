import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import type { Env } from '../src/types.ts';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    readonly TEST_MIGRATIONS: string;
  }
}

const TEST_TOKEN = 'test-secret-token';
const BASE_URL = 'http://localhost';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function applySchema(): Promise<void> {
  await applyD1Migrations(env.DB, JSON.parse(env.TEST_MIGRATIONS));
}

function get(path: string, token: string | null = TEST_TOKEN): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token !== null) headers['Authorization'] = `Bearer ${token}`;
  return SELF.fetch(`${BASE_URL}${path}`, { headers });
}

async function seedProject(
  name: string,
  slug: string,
  repoUrl: string | null = null,
): Promise<number> {
  const now = new Date().toISOString();
  await env.DB
    .prepare('INSERT INTO projects (slug, name, repo_url, created_at) VALUES (?, ?, ?, ?)')
    .bind(slug, name, repoUrl, now)
    .run();
  const row = await env.DB
    .prepare('SELECT id FROM projects WHERE slug = ?')
    .bind(slug)
    .first<{ id: number }>();
  return row!.id;
}

async function seedCostRecord(
  projectId: number,
  issueNumber: number,
  phase: string,
  model: string,
  provider: string,
  computedCost: number,
  reportedCost: number | null = null,
): Promise<number> {
  const row = await env.DB
    .prepare(`
      INSERT INTO cost_records
        (project_id, issue_number, phase, model, provider, computed_cost_usd, reported_cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `)
    .bind(projectId, issueNumber, phase, model, provider, computedCost, reportedCost)
    .first<{ id: number }>();
  return row!.id;
}

async function seedTokenUsage(costRecordId: number, tokenType: string, count: number): Promise<void> {
  await env.DB
    .prepare('INSERT INTO token_usage (cost_record_id, token_type, count) VALUES (?, ?, ?)')
    .bind(costRecordId, tokenType, count)
    .run();
}

beforeEach(async () => {
  await applySchema();
});

// ---------------------------------------------------------------------------
// GET /api/projects
// ---------------------------------------------------------------------------

describe('GET /api/projects', () => {
  it('returns 401 without auth token', async () => {
    const res = await get('/api/projects', null);
    expect(res.status).toBe(401);
  });

  it('returns empty array when no projects exist', async () => {
    const res = await get('/api/projects');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('returns projects sorted by name ASC', async () => {
    await seedProject('Zeta Project', 'zeta');
    await seedProject('Alpha Project', 'alpha');
    await seedProject('Mango Project', 'mango');

    const res = await get('/api/projects');
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ name: string }>;
    expect(body.map(p => p.name)).toEqual(['Alpha Project', 'Mango Project', 'Zeta Project']);
  });

  it('maps repo_url to camelCase repoUrl', async () => {
    await seedProject('Test', 'test', 'https://github.com/org/test');

    const res = await get('/api/projects');
    const [project] = await res.json() as Array<{ repoUrl: string | null }>;
    expect(project?.repoUrl).toBe('https://github.com/org/test');
  });

  it('returns null for repoUrl when not set', async () => {
    await seedProject('No URL', 'no-url', null);

    const res = await get('/api/projects');
    const [project] = await res.json() as Array<{ repoUrl: string | null }>;
    expect(project?.repoUrl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id/costs/breakdown
// ---------------------------------------------------------------------------

describe('GET /api/projects/:id/costs/breakdown', () => {
  it('returns 401 without auth token', async () => {
    const res = await get('/api/projects/1/costs/breakdown', null);
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-existent project ID', async () => {
    const res = await get('/api/projects/999/costs/breakdown');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Project not found' });
  });

  it('returns 404 for non-numeric project ID', async () => {
    const res = await get('/api/projects/abc/costs/breakdown');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Project not found' });
  });

  it('returns empty array for project with no cost records', async () => {
    const projectId = await seedProject('Empty', 'empty');

    const res = await get(`/api/projects/${projectId}/costs/breakdown`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('returns breakdown grouped by model+provider sorted by totalCost DESC', async () => {
    const projectId = await seedProject('Breakdown Test', 'breakdown');
    await seedCostRecord(projectId, 1, 'plan', 'gpt-4o', 'openai', 3.00);
    await seedCostRecord(projectId, 2, 'build', 'claude-sonnet-4-6', 'anthropic', 10.00);
    await seedCostRecord(projectId, 3, 'test', 'claude-sonnet-4-6', 'anthropic', 5.00);

    const res = await get(`/api/projects/${projectId}/costs/breakdown`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ model: string; provider: string; totalCost: number }>;

    expect(body).toHaveLength(2);
    // claude-sonnet-4-6/anthropic: 10+5=15, gpt-4o/openai: 3 — sorted DESC
    expect(body[0]).toMatchObject({ model: 'claude-sonnet-4-6', provider: 'anthropic', totalCost: 15 });
    expect(body[1]).toMatchObject({ model: 'gpt-4o', provider: 'openai', totalCost: 3 });
  });

  it('uses reported_cost_usd when present (COALESCE)', async () => {
    const projectId = await seedProject('Coalesce Test', 'coalesce');
    // reported_cost_usd is 2.0, computed is 0.5 — should prefer reported
    await seedCostRecord(projectId, 1, 'plan', 'claude-sonnet-4-6', 'anthropic', 0.5, 2.0);

    const res = await get(`/api/projects/${projectId}/costs/breakdown`);
    const [entry] = await res.json() as Array<{ totalCost: number }>;
    expect(entry?.totalCost).toBe(2.0);
  });

  it('falls back to computed_cost_usd when reported is null', async () => {
    const projectId = await seedProject('Fallback Test', 'fallback');
    await seedCostRecord(projectId, 1, 'plan', 'claude-sonnet-4-6', 'anthropic', 1.23, null);

    const res = await get(`/api/projects/${projectId}/costs/breakdown`);
    const [entry] = await res.json() as Array<{ totalCost: number }>;
    expect(entry?.totalCost).toBe(1.23);
  });
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id/costs/issues
// ---------------------------------------------------------------------------

describe('GET /api/projects/:id/costs/issues', () => {
  it('returns 401 without auth token', async () => {
    const res = await get('/api/projects/1/costs/issues', null);
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-existent project ID', async () => {
    const res = await get('/api/projects/999/costs/issues');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Project not found' });
  });

  it('returns 404 for non-numeric project ID', async () => {
    const res = await get('/api/projects/abc/costs/issues');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Project not found' });
  });

  it('returns empty array for project with no cost records', async () => {
    const projectId = await seedProject('Empty Issues', 'empty-issues');

    const res = await get(`/api/projects/${projectId}/costs/issues`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('returns issues sorted by issueNumber ASC', async () => {
    const projectId = await seedProject('Sort Test', 'sort-test');
    await seedCostRecord(projectId, 5, 'plan', 'm', 'anthropic', 1.0);
    await seedCostRecord(projectId, 1, 'plan', 'm', 'anthropic', 1.0);
    await seedCostRecord(projectId, 3, 'plan', 'm', 'anthropic', 1.0);

    const res = await get(`/api/projects/${projectId}/costs/issues`);
    const body = await res.json() as Array<{ issueNumber: number }>;
    expect(body.map(i => i.issueNumber)).toEqual([1, 3, 5]);
  });

  it('sorts phases in lifecycle order (plan → build → test → review → document)', async () => {
    const projectId = await seedProject('Phase Order', 'phase-order');
    // Insert in reverse lifecycle order to verify sort
    await seedCostRecord(projectId, 1, 'document', 'm', 'anthropic', 1.0);
    await seedCostRecord(projectId, 1, 'test', 'm', 'anthropic', 1.0);
    await seedCostRecord(projectId, 1, 'plan', 'm', 'anthropic', 1.0);
    await seedCostRecord(projectId, 1, 'review', 'm', 'anthropic', 1.0);
    await seedCostRecord(projectId, 1, 'build', 'm', 'anthropic', 1.0);

    const res = await get(`/api/projects/${projectId}/costs/issues`);
    const [issue] = await res.json() as Array<{ phases: Array<{ phase: string }> }>;
    expect(issue?.phases.map(p => p.phase)).toEqual(['plan', 'build', 'test', 'review', 'document']);
  });

  it('puts unknown phases after lifecycle phases, sorted alphabetically', async () => {
    const projectId = await seedProject('Custom Phase', 'custom-phase');
    await seedCostRecord(projectId, 1, 'zzz-custom', 'm', 'anthropic', 1.0);
    await seedCostRecord(projectId, 1, 'plan', 'm', 'anthropic', 1.0);
    await seedCostRecord(projectId, 1, 'aaa-custom', 'm', 'anthropic', 1.0);

    const res = await get(`/api/projects/${projectId}/costs/issues`);
    const [issue] = await res.json() as Array<{ phases: Array<{ phase: string }> }>;
    expect(issue?.phases.map(p => p.phase)).toEqual(['plan', 'aaa-custom', 'zzz-custom']);
  });

  it('totalCost is the sum of all phase costs for the issue', async () => {
    const projectId = await seedProject('Total Cost', 'total-cost');
    await seedCostRecord(projectId, 1, 'plan', 'm', 'anthropic', 2.0);
    await seedCostRecord(projectId, 1, 'build', 'm', 'anthropic', 3.0);
    await seedCostRecord(projectId, 1, 'test', 'm', 'anthropic', 1.5);

    const res = await get(`/api/projects/${projectId}/costs/issues`);
    const [issue] = await res.json() as Array<{ totalCost: number }>;
    expect(issue?.totalCost).toBeCloseTo(6.5);
  });

  it('aggregates token usage per phase across multiple cost records', async () => {
    const projectId = await seedProject('Token Agg', 'token-agg');
    const cr1 = await seedCostRecord(projectId, 1, 'build', 'm', 'anthropic', 1.0);
    await seedTokenUsage(cr1, 'input', 100);
    await seedTokenUsage(cr1, 'output', 200);

    const cr2 = await seedCostRecord(projectId, 1, 'build', 'm', 'anthropic', 2.0);
    await seedTokenUsage(cr2, 'input', 50);
    await seedTokenUsage(cr2, 'cache_read', 500);

    const res = await get(`/api/projects/${projectId}/costs/issues`);
    const [issue] = await res.json() as Array<{
      phases: Array<{ phase: string; cost: number; tokenUsage: Array<{ tokenType: string; count: number }> }>
    }>;

    const buildPhase = issue?.phases.find(p => p.phase === 'build');
    expect(buildPhase?.cost).toBeCloseTo(3.0);

    const tokenMap = Object.fromEntries(buildPhase!.tokenUsage.map(t => [t.tokenType, t.count]));
    expect(tokenMap['input']).toBe(150);
    expect(tokenMap['output']).toBe(200);
    expect(tokenMap['cache_read']).toBe(500);
  });

  it('returns phases with empty tokenUsage array when no token records exist', async () => {
    const projectId = await seedProject('No Tokens', 'no-tokens');
    await seedCostRecord(projectId, 1, 'plan', 'm', 'anthropic', 1.0);

    const res = await get(`/api/projects/${projectId}/costs/issues`);
    const [issue] = await res.json() as Array<{
      phases: Array<{ tokenUsage: unknown[] }>
    }>;
    expect(issue?.phases[0]?.tokenUsage).toEqual([]);
  });

  it('uses COALESCE: prefers reported_cost_usd over computed_cost_usd', async () => {
    const projectId = await seedProject('Coalesce Issues', 'coalesce-issues');
    await seedCostRecord(projectId, 1, 'plan', 'm', 'anthropic', 0.5, 2.0);

    const res = await get(`/api/projects/${projectId}/costs/issues`);
    const [issue] = await res.json() as Array<{
      totalCost: number;
      phases: Array<{ cost: number }>
    }>;
    expect(issue?.totalCost).toBe(2.0);
    expect(issue?.phases[0]?.cost).toBe(2.0);
  });
});
