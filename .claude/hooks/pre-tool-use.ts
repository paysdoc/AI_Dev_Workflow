#!/usr/bin/env bunx tsx
import * as fs from 'fs';
import * as path from 'path';
import { ensureSessionLogDir } from './utils/constants';

interface ToolInput {
  command?: string;
  file_path?: string;
  [key: string]: unknown;
}

interface HookInput {
  tool_name?: string;
  tool_input?: ToolInput;
  session_id?: string;
  [key: string]: unknown;
}

function isDangerousRmCommand(command: string): boolean {
  const normalized = command.toLowerCase().split(/\s+/).join(' ');

  const patterns = [
    /\brm\s+.*-[a-z]*r[a-z]*f/,
    /\brm\s+.*-[a-z]*f[a-z]*r/,
    /\brm\s+--recursive\s+--force/,
    /\brm\s+--force\s+--recursive/,
    /\brm\s+-r\s+.*-f/,
    /\brm\s+-f\s+.*-r/,
  ];

  for (const pattern of patterns) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  const dangerousPaths = [
    /\//,
    /\/\*/,
    /~/,
    /~\//,
    /\$HOME/,
    /\.\./,
    /\*/,
    /\./,
    /\.\s*$/,
  ];

  if (/\brm\s+.*-[a-z]*r/.test(normalized)) {
    for (const pathPattern of dangerousPaths) {
      if (pathPattern.test(normalized)) {
        return true;
      }
    }
  }

  return false;
}

function isEnvFileAccess(
  toolName: string,
  toolInput: ToolInput
): boolean {
  if (['Read', 'Edit', 'MultiEdit', 'Write', 'Bash'].includes(toolName)) {
    if (['Read', 'Edit', 'MultiEdit', 'Write'].includes(toolName)) {
      const filePath = toolInput.file_path || '';
      if (
        filePath.includes('.env') &&
        !filePath.endsWith('.env.sample') &&
        !filePath.endsWith('.env.example')
      ) {
        return true;
      }
    }

    if (toolName === 'Bash') {
      const command = toolInput.command || '';
      // Detect any reference to a .env file (but allow .env.sample / .env.example).
      // The leading (?<![\w.]) anchors the match to a path boundary so it
      // catches real filenames (".env", "path/.env", "./.env", ".env.local")
      // including a bare " .env" argument, while NOT matching word-internal
      // cases like "process.env" or ".environment".
      const envPatterns = [
        /(?<![\w.])\.env\b(?!\.(?:sample|example))/,
      ];

      for (const pattern of envPatterns) {
        if (pattern.test(command)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * When Claude Code agents run inside a worktree, their file tool calls
 * resolve against the git repository root instead of the worktree cwd.
 *
 * Returns modified toolInput if rewriting occurred, null otherwise.
 */
function rewriteWorktreePath(toolName: string, toolInput: ToolInput): ToolInput | null {
  const worktreePath = process.env.ADW_WORKTREE_PATH;
  const mainRepoPath = process.env.ADW_MAIN_REPO_PATH;

  if (!worktreePath || !mainRepoPath) {
    return null;
  }

  const rewritableTools = ['Write', 'Edit', 'Read', 'Glob', 'Grep', 'MultiEdit'];
  if (!rewritableTools.includes(toolName)) {
    return null;
  }

  let modified = false;
  const result = { ...toolInput };

  if (typeof result.file_path === 'string') {
    if (result.file_path.startsWith(mainRepoPath) && !result.file_path.startsWith(worktreePath)) {
      result.file_path = worktreePath + result.file_path.slice(mainRepoPath.length);
      modified = true;
    }
  }

  if (typeof result.path === 'string') {
    if (result.path.startsWith(mainRepoPath) && !result.path.startsWith(worktreePath)) {
      result.path = worktreePath + (result.path as string).slice(mainRepoPath.length);
      modified = true;
    }
  }

  return modified ? result : null;
}

async function main(): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const inputData: HookInput = JSON.parse(Buffer.concat(chunks).toString());

    const toolName = inputData.tool_name || '';
    const toolInput = inputData.tool_input || {};

    const rewrittenInput = rewriteWorktreePath(toolName, toolInput);
    if (rewrittenInput) {
      console.log(JSON.stringify({ tool_input: rewrittenInput }));
    }

    // Use the potentially-rewritten input for subsequent safety checks
    const effectiveInput = rewrittenInput || toolInput;

    if (isEnvFileAccess(toolName, effectiveInput)) {
      console.error(
        'BLOCKED: Access to .env files containing sensitive data is prohibited'
      );
      console.error('Use .env.sample for template files instead');
      process.exit(2); // Exit code 2 blocks tool call and shows error to Claude
    }

    if (toolName === 'Bash') {
      const command = effectiveInput.command || '';

      if (isDangerousRmCommand(command)) {
        console.error('BLOCKED: Dangerous rm command detected and prevented');
        process.exit(2); // Exit code 2 blocks tool call and shows error to Claude
      }
    }

    const sessionId = inputData.session_id || 'unknown';

    const logDir = ensureSessionLogDir(sessionId);
    const logPath = path.join(logDir, 'pre_tool_use.json');

    let logData: unknown[] = [];
    if (fs.existsSync(logPath)) {
      try {
        const content = fs.readFileSync(logPath, 'utf-8');
        logData = JSON.parse(content);
      } catch {
        logData = [];
      }
    }

    logData.push({ ...inputData, tool_input: effectiveInput });

    fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));

    process.exit(0);
  } catch {
    process.exit(0);
  }
}

main();
