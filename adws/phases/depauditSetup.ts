import { execWithRetry as defaultExecWithRetry, log as defaultLog } from '../core';
import type { LogLevel } from '../core';
import type { WorkflowConfig } from './workflowInit';
import { getRepoInfo } from '../github';

export interface DepauditSetupDeps {
  execWithRetry?: typeof defaultExecWithRetry;
  log?: (message: string, level?: LogLevel) => void;
  getEnv?: (name: string) => string | undefined;
}

export interface DepauditSetupResult {
  success: boolean;
  warnings: string[];
  skippedSecrets: string[];
}

const SECRET_NAMES = ['SOCKET_API_TOKEN', 'SLACK_WEBHOOK_URL'] as const;
type SecretName = typeof SECRET_NAMES[number];

const DEFAULT_DEPS: Required<DepauditSetupDeps> = {
  execWithRetry: defaultExecWithRetry,
  log: defaultLog,
  getEnv: (name: string) => process.env[name],
};

async function propagateSecret(
  envName: SecretName,
  ownerRepo: string,
  deps: Required<DepauditSetupDeps>,
): Promise<{ propagated: boolean; warning?: string }> {
  const envValue = deps.getEnv(envName);
  if (!envValue) {
    return { propagated: false, warning: `${envName} not set — skipping gh secret set` };
  }
  try {
    deps.execWithRetry(`gh secret set ${envName} --repo ${ownerRepo} --body -`, {
      input: envValue,
      maxAttempts: 3,
    });
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
  const d: Required<DepauditSetupDeps> = { ...DEFAULT_DEPS, ...deps };
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

  const ownerRepo = config.targetRepo
    ? `${config.targetRepo.owner}/${config.targetRepo.repo}`
    : (() => { const info = getRepoInfo(); return `${info.owner}/${info.repo}`; })();

  for (const secretName of SECRET_NAMES) {
    const result = await propagateSecret(secretName, ownerRepo, d);
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
