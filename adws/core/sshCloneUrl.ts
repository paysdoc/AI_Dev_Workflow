/**
 * ADW-owned, host-neutral HTTPS-to-SSH clone URL rewrite (#844) — replaces
 * the GitHub-only `convertToSshUrl` (`adws/providers/github/cloneUrl.ts`).
 * `adws/core/targetRepoManager.ts` applies this before handing the git core
 * a clone URL; the core itself clones exactly the URL it is given (#793).
 *
 * Rule: `https://<host>/<owner>/<repo>[.git]` → `git@<host>:<owner>/<repo>.git`.
 * Anything else — already SSH, `ssh://`, a port, more/fewer than two path
 * segments, `http://`, garbage — passes through unchanged.
 */

/** True when `url` is a two-segment HTTPS clone URL with no explicit port. */
function isConvertibleHttpsUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && pathSegments(url).length === 2;
}

function pathSegments(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean);
}

/** Converts an HTTPS clone URL to SSH form; anything else is returned unchanged. */
export function convertToSshUrl(cloneUrl: string): string {
  let url: URL;
  try {
    url = new URL(cloneUrl);
  } catch {
    return cloneUrl;
  }

  if (!isConvertibleHttpsUrl(url)) return cloneUrl;

  const [owner, rawRepo] = pathSegments(url);
  const repo = rawRepo.endsWith('.git') ? rawRepo.slice(0, -'.git'.length) : rawRepo;
  return `git@${url.hostname}:${owner}/${repo}.git`;
}
