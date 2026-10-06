import type { GitContext } from '@paysdoc/devplatform/git';
import { requireWorkflowGitContext } from './workflowRepoIdentity';
import type { WorkflowConfig } from './workflowInit';

export interface BaseCheckout {
  readonly path: string;
  readonly baseBranch: string;
  readonly commit: string;
}

export interface BaseWorktreePort {
  ensure(): BaseCheckout;
  remove(): void;
}

export interface BaseWorktreeDeps {
  readonly git: Pick<GitContext, 'fetchRemote' | 'addDetachedWorktree' | 'removeWorktree' | 'worktreePathFor' | 'copyEnvToWorktree' | 'headShort'>;
  readonly onExit: (cleanup: () => void) => void;
}

type BaseWorktreeConfig = Pick<WorkflowConfig, 'issueNumber' | 'adwId' | 'defaultBranch' | 'worktreePath' | 'gitContext'>;

// A killed process leaves its checkout behind. The `-issue-<N>-` in the name is what lets `## Cancel`, the issue-close
// cleanup, the dev-server janitor and the next run's ensure() find and remove it.
export function baseWorktreeName(issueNumber: number, adwId: string): string {
  return `base-issue-${issueNumber}-${adwId}`;
}

const onProcessExit: BaseWorktreeDeps['onExit'] = (cleanup) => {
  process.once('exit', cleanup);
};

function createCheckout(git: BaseWorktreeDeps['git'], config: BaseWorktreeConfig, name: string): BaseCheckout {
  git.removeWorktree(name);
  git.fetchRemote(config.defaultBranch, config.worktreePath);
  const path = git.worktreePathFor(name);
  git.addDetachedWorktree(path, `origin/${config.defaultBranch}`, config.worktreePath);
  git.copyEnvToWorktree(path);
  return { path, baseBranch: config.defaultBranch, commit: git.headShort(path) };
}

export function buildBaseWorktreePort(config: BaseWorktreeConfig, deps: Partial<BaseWorktreeDeps> = {}): BaseWorktreePort {
  const name = baseWorktreeName(config.issueNumber, config.adwId);
  const onExit = deps.onExit ?? onProcessExit;
  const resolveGit = (): BaseWorktreeDeps['git'] => deps.git ?? requireWorkflowGitContext(config);
  let checkout: BaseCheckout | undefined;

  const remove = (): void => {
    if (!checkout) return;
    checkout = undefined;
    resolveGit().removeWorktree(name);
  };

  const ensure = (): BaseCheckout => {
    if (checkout) return checkout;
    const created = createCheckout(resolveGit(), config, name);
    checkout = created;
    // Every way an orchestrator ends goes through process.exit or a drained event loop, so this runs on a normal end,
    // a park, an error and a pause. removeWorktree is synchronous, so it can run in an 'exit' handler.
    onExit(remove);
    return created;
  };

  return { ensure, remove };
}

const sharedPorts = new Map<string, BaseWorktreePort>();

export function sharedBaseWorktree(config: BaseWorktreeConfig): BaseWorktreePort {
  const existing = sharedPorts.get(config.adwId);
  if (existing) return existing;

  const port = buildBaseWorktreePort(config);
  const shared: BaseWorktreePort = {
    ensure: port.ensure,
    remove: () => {
      sharedPorts.delete(config.adwId);
      port.remove();
    },
  };
  sharedPorts.set(config.adwId, shared);
  return shared;
}
