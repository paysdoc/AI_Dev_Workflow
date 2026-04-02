/**
 * Cost API Worker
 *
 * Exposes cost data via authenticated HTTP endpoints backed by a D1 database.
 * All routes require a Bearer token matching `COST_API_TOKEN`, except OPTIONS
 * preflight requests which are handled without auth.
 *
 * Routes:
 *   POST   /api/cost                          — ingest cost records
 *   GET    /api/projects                      — list all projects
 *   GET    /api/projects/:id/costs/breakdown  — cost by model+provider
 *   GET    /api/projects/:id/costs/issues     — per-issue cost with phase breakdown
 */

import { Router } from 'itty-router';
import type { IRequest } from 'itty-router';
import { authenticate } from './auth.ts';
import { handleIngest } from './ingest.ts';
import { handleGetProjects, handleGetCostBreakdown, handleGetCostIssues } from './queries.ts';
import { handleOptions, withCors } from './cors.ts';
import type { Env } from './types.ts';

const router = Router();

// OPTIONS preflight — no auth required
router.options('*', (request: IRequest, env: Env) => handleOptions(request, env));

function requireAuth(request: IRequest, env: Env): Response | undefined {
  if (!authenticate(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

router.post('/api/cost', (request: IRequest, env: Env) => {
  const authError = requireAuth(request, env);
  if (authError) return authError;
  return handleIngest(request, env);
});

// Reject other methods on /api/cost (must come after the POST route)
router.all('/api/cost', (request: IRequest, env: Env) => {
  const authError = requireAuth(request, env);
  if (authError) return authError;
  return new Response(null, { status: 405 });
});

router.get('/api/projects', (request: IRequest, env: Env) => {
  const authError = requireAuth(request, env);
  if (authError) return authError;
  return handleGetProjects(env);
});

router.get('/api/projects/:id/costs/breakdown', (request: IRequest, env: Env) => {
  const authError = requireAuth(request, env);
  if (authError) return authError;
  return handleGetCostBreakdown(request.params['id'] ?? '', env);
});

router.get('/api/projects/:id/costs/issues', (request: IRequest, env: Env) => {
  const authError = requireAuth(request, env);
  if (authError) return authError;
  return handleGetCostIssues(request.params['id'] ?? '', env);
});

router.all('*', () => new Response(null, { status: 404 }));

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await router.fetch(request, env) ?? new Response(null, { status: 404 });
    // OPTIONS response already carries CORS headers from handleOptions
    if (request.method === 'OPTIONS') return response;
    return withCors(response, request, env);
  },
};
