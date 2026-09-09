import { execWithRetry as defaultExecWithRetry, log as defaultLog } from '../core';
import type { LogLevel } from '../core';
import type { WorkflowConfig } from './workflowInit';
import { resolveWorkflowRepoId } from './workflowRepoIdentity';
import type { CodeHost } from '../providers/types';

export interface DepauditSetupDeps {
  execWithRetry?: typeof defaultExecWithRetry;
  log?: (message: string, level?: LogLevel) => void;
  getEnv?: (name: string) => string | undefined;
  codeHost?: CodeHost;
}

export interface DepauditSetupResult {
  success: boolean;
  warnings: string[];
  skippedSecrets: string[];
}

const SECRET_NAMES = ['SOCKET_API_TOKEN', 'SLACK_WEBHOOK_URL'] as const;
type SecretName = typeof SECRET_NAMES[number];

const DEFAULT_DEPS: Pick<Required<DepauditSetupDeps>, 'execWithRetry' | 'log' | 'getEnv'> = {
  execWithRetry: defaultExecWithRetry,
  log: defaultLog,
  getEnv: (name: string) => process.env[name],
};

async function propagateSecret(
  envName: SecretName,
  codeHost: CodeHost | undefined,
  ownerRepo: string,
  deps: Pick<Required<DepauditSetupDeps>, 'log' | 'getEnv'>,
): Promise<{ propagated: boolean; warning?: string }> {
  const envValue = deps.getEnv(envName);
  if (!envValue) {
    return { propagated: false, warning: `${envName} not set — skipping gh secret set` };
  }
  if (!codeHost) {
    return { propagated: false, warning: `${envName} could not be propagated — no repo context for this run` };
  }
  try {
    codeHost.setSecret(envName, envValue);
    deps.log(`Propagated ${envName} to ${ownerRepo} GitHub Actions secrets`, 'success');
    return { propagated: true };
  } catch (error) {
    return { propagated: false, warning: `Failed to set ${envName} on ${ownerRepo}: ${error}` };
  }
}

export async function executeDepauditSetup(
  config: WorkflowConfig,
  deps?: DepauditSetupDeps,
): Promise<DepauditSetupResult> {
  const d = { ...DEFAULT_DEPS, ...deps };
  const codeHost = deps?.codeHost ?? config.repoContext?.codeHost;
  const warnings: string[] = [];
  const skippedSecrets: string[] = [];

  try {
    d.execWithRetry('depaudit setup', { cwd: config.worktreePath, maxAttempts: 2 });
    d.log('depaudit setup completed', 'success');
  } catch (error) {
    const msg = `depaudit setup failed: ${error}. Continuing — ensure 'npm install -g depaudit' is present on the ADW host.`;
    d.log(msg, 'warn');
    warnings.push(msg);
  }

  const { owner, repo } = resolveWorkflowRepoId(config);
  const ownerRepo = `${owner}/${repo}`;

  for (const secretName of SECRET_NAMES) {
    const result = await propagateSecret(secretName, codeHost, ownerRepo, d);
    if (!result.propagated) {
      if (result.warning) {
        d.log(result.warning, 'warn');
        warnings.push(result.warning);
      }
      skippedSecrets.push(secretName);
    }
  }

  return { success: true, warnings, skippedSecrets };
}
