import { GitContext, createLiteralTokenProvider } from '@paysdoc/devplatform/git';
import type { ExecFn } from '@paysdoc/devplatform/git';

export interface SpyCall {
  argv: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

function isConflictingMerge(argv: readonly string[]): boolean {
  return argv[1] === 'merge' && (argv.includes('--no-commit') || argv.includes('--no-edit'));
}

export function makeSpyExec(
  stdout = '',
  conflictOnMerge: boolean | (() => boolean) = false,
): { exec: ExecFn; calls: SpyCall[] } {
  const calls: SpyCall[] = [];
  const conflicts = typeof conflictOnMerge === 'function' ? conflictOnMerge : () => conflictOnMerge;
  const exec: ExecFn = (argv, options) => {
    calls.push({ argv: [...argv], cwd: options.cwd, env: options.env });
    if (conflicts() && isConflictingMerge(argv)) {
      throw Object.assign(new Error('CONFLICT (content)'), { status: 1 });
    }
    return stdout;
  };
  return { exec, calls };
}

export function makeGitContext(exec: ExecFn, owner = 'acme', repo = 'widgets'): GitContext {
  return new GitContext(
    {
      owner,
      repo,
      selfHost: false,
      tokenProvider: createLiteralTokenProvider('test-token'),
      gitIdentity: {
        authorName: 'ADW Bot',
        authorEmail: 'bot@adw.dev',
        committerName: 'ADW Bot',
        committerEmail: 'bot@adw.dev',
      },
      frameworkRepoRoot: '/srv/adw/framework',
      targetReposDir: '/srv/adw/repos',
    },
    { exec },
  );
}
