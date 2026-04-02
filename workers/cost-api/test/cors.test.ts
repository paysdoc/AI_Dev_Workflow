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

async function applySchema(): Promise<void> {
  await applyD1Migrations(env.DB, JSON.parse(env.TEST_MIGRATIONS));
}

beforeEach(async () => {
  await applySchema();
});

// ---------------------------------------------------------------------------
// OPTIONS preflight
// ---------------------------------------------------------------------------

describe('OPTIONS preflight', () => {
  it('returns 204 with CORS headers for allowed origin', async () => {
    const res = await SELF.fetch(`${BASE_URL}/api/projects`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost');
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Authorization, Content-Type');
  });

  it('does not require auth for OPTIONS', async () => {
    const res = await SELF.fetch(`${BASE_URL}/api/projects`, {
      method: 'OPTIONS',
      headers: { 'Origin': 'http://localhost' },
    });
    expect(res.status).toBe(204);
  });

  it('omits Access-Control-Allow-Origin for disallowed origin on preflight', async () => {
    const res = await SELF.fetch(`${BASE_URL}/api/projects`, {
      method: 'OPTIONS',
      headers: { 'Origin': 'https://evil.com' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CORS on GET responses
// ---------------------------------------------------------------------------

describe('CORS on GET responses', () => {
  it('adds Access-Control-Allow-Origin for allowed origin', async () => {
    const res = await SELF.fetch(`${BASE_URL}/api/projects`, {
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`,
        'Origin': 'http://localhost',
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost');
  });

  it('omits Access-Control-Allow-Origin for disallowed origin', async () => {
    const res = await SELF.fetch(`${BASE_URL}/api/projects`, {
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`,
        'Origin': 'https://evil.com',
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('adds CORS headers to 401 responses', async () => {
    const res = await SELF.fetch(`${BASE_URL}/api/projects`, {
      headers: { 'Origin': 'http://localhost' },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost');
  });
});

// ---------------------------------------------------------------------------
// CORS on POST responses (regression)
// ---------------------------------------------------------------------------

describe('CORS on POST /api/cost', () => {
  it('adds Access-Control-Allow-Origin for allowed origin', async () => {
    const res = await SELF.fetch(`${BASE_URL}/api/cost`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
        'Origin': 'http://localhost',
      },
      body: JSON.stringify({
        project: 'cors-test',
        records: [{
          issue_number: 1,
          phase: 'build',
          model: 'claude-sonnet-4-6',
          computed_cost_usd: 0.5,
          token_usage: {},
        }],
      }),
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost');
  });
});
