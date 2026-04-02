import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import type { Env } from '../src/types.ts';

// Augment ProvidedEnv so `env` from cloudflare:test is typed with our bindings.
// TEST_MIGRATIONS is a test-only binding: serialised D1Migration[] injected by vitest.config.ts.
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
  // Re-apply schema before each test so every case starts with a clean DB shape.
  await applyD1Migrations(env.DB, JSON.parse(env.TEST_MIGRATIONS));
}

function post(
  body: unknown,
  token: string | null = TEST_TOKEN,
): Promise<Response> {
  // Shared request helper for the ingest endpoint. Passing null omits auth entirely.
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== null) headers['Authorization'] = `Bearer ${token}`;
  return SELF.fetch(`${BASE_URL}/api/cost`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const minimalRecord = {
  issue_number: 42,
  phase: 'build',
  model: 'claude-sonnet-4-6',
  computed_cost_usd: 1.23,
  token_usage: { input: 100, output: 200 },
} as const;

beforeEach(async () => {
  // Keep tests independent by ensuring the latest migrations are applied per run.
  await applySchema();
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe('auth', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await post({ project: 'test', records: [minimalRecord] }, null);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 401 when token is invalid', async () => {
    const res = await post({ project: 'test', records: [minimalRecord] }, 'wrong-token');
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header has no Bearer prefix', async () => {
    const res = await SELF.fetch(`${BASE_URL}/api/cost`, {
      method: 'POST',
      headers: { 'Authorization': TEST_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: 'test', records: [minimalRecord] }),
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

describe('payload validation', () => {
  it('returns 400 when project field is missing', async () => {
    const res = await post({ records: [minimalRecord] });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('project');
  });

  it('returns 400 when records field is missing', async () => {
    const res = await post({ project: 'test' });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('records');
  });

  it('returns 400 when records array is empty', async () => {
    const res = await post({ project: 'test', records: [] });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('records');
  });

  it('returns 400 when a record is missing issue_number', async () => {
    const res = await post({ project: 'test', records: [{ phase: 'build', model: 'm', computed_cost_usd: 1, token_usage: {} }] });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('issue_number');
  });

  it('returns 400 when a record is missing phase', async () => {
    const res = await post({ project: 'test', records: [{ issue_number: 1, model: 'm', computed_cost_usd: 1, token_usage: {} }] });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('phase');
  });

  it('returns 400 when a record is missing model', async () => {
    const res = await post({ project: 'test', records: [{ issue_number: 1, phase: 'build', computed_cost_usd: 1, token_usage: {} }] });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('model');
  });

  it('returns 400 when a record is missing computed_cost_usd', async () => {
    const res = await post({ project: 'test', records: [{ issue_number: 1, phase: 'build', model: 'm', token_usage: {} }] });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('computed_cost_usd');
  });

  it('returns 400 when body is not a JSON object', async () => {
    const res = await SELF.fetch(`${BASE_URL}/api/cost`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TEST_TOKEN}`, 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is a JSON array', async () => {
    const res = await SELF.fetch(`${BASE_URL}/api/cost`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TEST_TOKEN}`, 'Content-Type': 'application/json' },
      body: '[]',
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Successful insert
// ---------------------------------------------------------------------------

describe('successful insert', () => {
  it('returns 201 with inserted count', async () => {
    const res = await post({ project: 'AI_Dev_Workflow', records: [minimalRecord] });
    expect(res.status).toBe(201);
    const body = await res.json() as { inserted: number };
    expect(body.inserted).toBe(1);
  });

  it('inserts the cost_record row into D1', async () => {
    await post({ project: 'test-project', records: [minimalRecord] });
    // Verify persistence and default enrichment performed by the ingest handler.
    const row = await env.DB
      .prepare('SELECT * FROM cost_records WHERE issue_number = 42')
      .first<Record<string, unknown>>();
    expect(row).not.toBeNull();
    expect(row?.['phase']).toBe('build');
    expect(row?.['model']).toBe('claude-sonnet-4-6');
    expect(row?.['provider']).toBe('anthropic');
    expect(row?.['computed_cost_usd']).toBe(1.23);
  });

  it('defaults provider to anthropic when omitted', async () => {
    await post({ project: 'test', records: [minimalRecord] });
    const row = await env.DB
      .prepare('SELECT provider FROM cost_records')
      .first<{ provider: string }>();
    expect(row?.provider).toBe('anthropic');
  });

  it('stores optional fields when provided', async () => {
    const record = {
      ...minimalRecord,
      workflow_id: 'abc123',
      issue_description: 'feature build',
      provider: 'anthropic',
      reported_cost_usd: 1.20,
      status: 'success',
      retry_count: 1,
      continuation_count: 2,
      duration_ms: 60000,
      timestamp: '2026-03-27T10:00:00Z',
    };
    await post({ project: 'test', records: [record] });
    const row = await env.DB
      .prepare('SELECT * FROM cost_records')
      .first<Record<string, unknown>>();
    expect(row?.['workflow_id']).toBe('abc123');
    expect(row?.['status']).toBe('success');
    expect(row?.['retry_count']).toBe(1);
    expect(row?.['continuation_count']).toBe(2);
    expect(row?.['duration_ms']).toBe(60000);
  });
});

// ---------------------------------------------------------------------------
// Project auto-creation
// ---------------------------------------------------------------------------

describe('project auto-creation', () => {
  it('auto-creates project row with slug as name when name is not provided', async () => {
    await post({ project: 'new-project', records: [minimalRecord] });
    const project = await env.DB
      .prepare('SELECT * FROM projects WHERE slug = ?')
      .bind('new-project')
      .first<Record<string, unknown>>();
    expect(project).not.toBeNull();
    expect(project?.['name']).toBe('new-project');
    expect(project?.['repo_url']).toBeNull();
  });

  it('uses provided name and repo_url when creating project', async () => {
    await post({
      project: 'my-proj',
      name: 'My Project',
      repo_url: 'https://github.com/org/my-proj',
      records: [minimalRecord],
    });
    const project = await env.DB
      .prepare('SELECT * FROM projects WHERE slug = ?')
      .bind('my-proj')
      .first<Record<string, unknown>>();
    expect(project?.['name']).toBe('My Project');
    expect(project?.['repo_url']).toBe('https://github.com/org/my-proj');
  });

  it('resolves duplicate project slug to the same project_id', async () => {
    await post({ project: 'dup-project', records: [minimalRecord] });
    await post({ project: 'dup-project', records: [minimalRecord] });

    // Both inserts should point at exactly one project row for that slug.
    const { results } = await env.DB
      .prepare('SELECT DISTINCT project_id FROM cost_records')
      .all<{ project_id: number }>();
    expect(results).toHaveLength(1);

    const projectCount = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM projects WHERE slug = ?')
      .bind('dup-project')
      .first<{ n: number }>();
    expect(projectCount?.n).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Token usage fan-out
// ---------------------------------------------------------------------------

describe('token_usage fan-out', () => {
  it('creates one token_usage row per token type', async () => {
    await post({
      project: 'token-test',
      records: [{
        ...minimalRecord,
        token_usage: { input: 100, output: 200, cache_read: 1500, cache_write: 80 },
      }],
    });
    const { results } = await env.DB
      .prepare('SELECT token_type, count FROM token_usage ORDER BY token_type')
      .all<{ token_type: string; count: number }>();
    // Token map keys should fan out into separate rows.
    expect(results).toHaveLength(4);
    expect(results.map(r => r.token_type)).toEqual(['cache_read', 'cache_write', 'input', 'output']);
    expect(results.find(r => r.token_type === 'input')?.count).toBe(100);
    expect(results.find(r => r.token_type === 'cache_read')?.count).toBe(1500);
  });

  it('inserts no token_usage rows when token_usage map is empty', async () => {
    await post({
      project: 'empty-tokens',
      records: [{ ...minimalRecord, token_usage: {} }],
    });
    const { results } = await env.DB
      .prepare('SELECT * FROM token_usage')
      .all<Record<string, unknown>>();
    expect(results).toHaveLength(0);
  });

  it('links token_usage rows to the correct cost_record', async () => {
    await post({ project: 'link-test', records: [minimalRecord] });
    const costRecord = await env.DB
      .prepare('SELECT id FROM cost_records')
      .first<{ id: number }>();
    const { results } = await env.DB
      .prepare('SELECT cost_record_id FROM token_usage')
      .all<{ cost_record_id: number }>();
    // Every token_usage entry should reference the same inserted parent record.
    expect(results.every(r => r.cost_record_id === costRecord?.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Batch insert
// ---------------------------------------------------------------------------

describe('batch insert', () => {
  it('inserts all records in a single request and returns correct count', async () => {
    const records = [
      { ...minimalRecord, issue_number: 1, phase: 'plan' },
      { ...minimalRecord, issue_number: 2, phase: 'build' },
      { ...minimalRecord, issue_number: 3, phase: 'test' },
    ];
    const res = await post({ project: 'batch-test', records });
    expect(res.status).toBe(201);
    const body = await res.json() as { inserted: number };
    expect(body.inserted).toBe(3);
    const { results } = await env.DB
      .prepare('SELECT * FROM cost_records ORDER BY issue_number')
      .all<{ issue_number: number; phase: string }>();
    expect(results).toHaveLength(3);
    expect(results[0]?.phase).toBe('plan');
    expect(results[1]?.phase).toBe('build');
    expect(results[2]?.phase).toBe('test');
  });

  it('fans out token_usage for all records in a batch', async () => {
    const records = [
      { ...minimalRecord, token_usage: { input: 10, output: 20 } },
      { ...minimalRecord, token_usage: { input: 30, output: 40, cache_read: 50 } },
    ];
    await post({ project: 'batch-tokens', records });
    const { results } = await env.DB
      .prepare('SELECT * FROM token_usage')
      .all<Record<string, unknown>>();
    // 2 tokens for first record + 3 tokens for second record
    expect(results).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

describe('routing', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await SELF.fetch(`${BASE_URL}/unknown`, {
      headers: { 'Authorization': `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(404);
  });

  it('returns 405 for GET on /api/cost', async () => {
    const res = await SELF.fetch(`${BASE_URL}/api/cost`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(405);
  });

  it('returns 405 for PUT on /api/cost', async () => {
    const res = await SELF.fetch(`${BASE_URL}/api/cost`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(405);
  });
});
