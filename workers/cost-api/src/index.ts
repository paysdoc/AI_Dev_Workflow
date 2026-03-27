/**
 * Cost API Worker
 *
 * Accepts cost records via `POST /api/cost` and persists them to a D1
 * database (`adw-costs`). All requests are authenticated via a bearer token
 * validated against the `COST_API_TOKEN` Worker secret.
 */

import { authenticate } from './auth.ts';
import { handleIngest } from './ingest.ts';
import type { Env } from './types.ts';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Auth is checked first — all routes require a valid bearer token.
    if (!authenticate(request, env)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { pathname } = new URL(request.url);

    if (pathname === '/api/cost') {
      if (request.method === 'POST') {
        return handleIngest(request, env);
      }
      return new Response(null, { status: 405 });
    }

    return new Response(null, { status: 404 });
  },
};
