import type { Env } from './types.ts';

/**
 * Derives CORS response headers from the request origin and env config.
 * If the request origin is in the `ALLOWED_ORIGINS` list (defaults to
 * `https://paysdoc.nl`), the `Access-Control-Allow-Origin` header is set.
 * If not, the header is omitted so the browser blocks the cross-origin read.
 */
export function corsHeaders(request: Request, env: Env): Record<string, string> {
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? 'https://paysdoc.nl')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  const origin = request.headers.get('Origin') ?? '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };

  if (allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

/** Handles OPTIONS preflight — returns 204 with CORS headers, no auth required. */
export function handleOptions(request: Request, env: Env): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request, env),
  });
}

/** Clones a response with CORS headers merged in. */
export function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env))) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
