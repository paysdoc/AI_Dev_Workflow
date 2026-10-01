/**
 * The environment of the host the feature-933 commit scenarios stand in for. The host's own git
 * identity is in git configuration and none is in its environment, as on the cron host.
 * `getSafeSubprocessEnv()` hands GIT_AUTHOR_* and GIT_COMMITTER_* to the agent's CLI, so a runner that
 * exports them would hide the bug.
 */

const GIT_IDENTITY_VARIABLES = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'] as const;

/** Everything a step of these scenarios may leave changed in process.env. */
const SCENARIO_VARIABLES = [...GIT_IDENTITY_VARIABLES, 'CLAUDE_CODE_PATH'] as const;

/** A variable that is unset maps to undefined. */
export type EnvSnapshot = Readonly<Record<string, string | undefined>>;

function snapshotOf(names: readonly string[]): EnvSnapshot {
  return Object.fromEntries(names.map(name => [name, process.env[name]]));
}

export function snapshotScenarioEnv(): EnvSnapshot {
  return snapshotOf(SCENARIO_VARIABLES);
}

export function restoreEnv(snapshot: EnvSnapshot): void {
  Object.entries(snapshot).forEach(([name, value]) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  });
}

/** Runs `action` with the four git identity variables removed from process.env, and puts them back afterwards. */
export async function withoutGitIdentityEnv<T>(action: () => Promise<T>): Promise<T> {
  const saved = snapshotOf(GIT_IDENTITY_VARIABLES);
  GIT_IDENTITY_VARIABLES.forEach(name => { delete process.env[name]; });
  try {
    return await action();
  } finally {
    restoreEnv(saved);
  }
}
