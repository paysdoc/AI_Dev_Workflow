#!/usr/bin/env bunx tsx
/**
 * Pre-tool-use hook for Claude Code.
 * Blocks dangerous commands and .env file access.
 */

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

/**
 * Comprehensive detection of dangerous rm commands.
 * Matches various forms of rm -rf and similar destructive patterns.
 */
function isDangerousRmCommand(command: string): boolean {
  // Normalize command by removing extra spaces and converting to lowercase
  const normalized = command.toLowerCase().split(/\s+/).join(' ');

  // Pattern 1: Standard rm -rf variations
  const patterns = [
    /\brm\s+.*-[a-z]*r[a-z]*f/, // rm -rf, rm -fr, rm -Rf, etc.
    /\brm\s+.*-[a-z]*f[a-z]*r/, // rm -fr variations
    /\brm\s+--recursive\s+--force/, // rm --recursive --force
    /\brm\s+--force\s+--recursive/, // rm --force --recursive
    /\brm\s+-r\s+.*-f/, // rm -r ... -f
    /\brm\s+-f\s+.*-r/, // rm -f ... -r
  ];

  // Check for dangerous patterns
  for (const pattern of patterns) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  // Pattern 2: Check for rm with recursive flag targeting dangerous paths
  const dangerousPaths = [
    /\//, // Root directory
    /\/\*/, // Root with wildcard
    /~/, // Home directory
    /~\//, // Home directory path
    /\$HOME/, // Home environment variable
    /\.\./, // Parent directory references
    /\*/, // Wildcards in general rm -rf context
    /\./, // Current directory
    /\.\s*$/, // Current directory at end of command
  ];

  if (/\brm\s+.*-[a-z]*r/.test(normalized)) {
    // If rm has recursive flag
    for (const pathPattern of dangerousPaths) {
      if (pathPattern.test(normalized)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if any tool is trying to access .env files containing sensitive data.
 */
function isEnvFileAccess(
  toolName: string,
  toolInput: ToolInput
): boolean {
  if (['Read', 'Edit', 'MultiEdit', 'Write', 'Bash'].includes(toolName)) {
    // Check file paths for file-based tools
    if (['Read', 'Edit', 'MultiEdit', 'Write'].includes(toolName)) {
      const filePath = toolInput.file_path || '';
      if (filePath.includes('.env') && !filePath.endsWith('.env.sample')) {
        return true;
      }
    }

    // Check bash commands for .env file access
    if (toolName === 'Bash') {
      const command = toolInput.command || '';
      // Pattern to detect .env file access (but allow .env.sample)
      const envPatterns = [
        /\b\.env\b(?!\.sample)/, // .env but not .env.sample
        /cat\s+.*\.env\b(?!\.sample)/, // cat .env
        /echo\s+.*>\s*\.env\b(?!\.sample)/, // echo > .env
        /touch\s+.*\.env\b(?!\.sample)/, // touch .env
        /cp\s+.*\.env\b(?!\.sample)/, // cp .env
        /mv\s+.*\.env\b(?!\.sample)/, // mv .env
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
 * Rewrites file paths from the main repo root to the worktree path.
 * When Claude Code agents run inside a worktree, their file tool calls
 * resolve against the git repository root instead of the worktree cwd.
 * This intercepts those calls and redirects them to the worktree.
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

  // Rewrite file_path parameter (Write, Edit, Read, MultiEdit)
  if (typeof result.file_path === 'string') {
    if (result.file_path.startsWith(mainRepoPath) && !result.file_path.startsWith(worktreePath)) {
      result.file_path = worktreePath + result.file_path.slice(mainRepoPath.length);
      modified = true;
    }
  }

  // Rewrite path parameter (Glob, Grep)
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
    // Read JSON input from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const inputData: HookInput = JSON.parse(Buffer.concat(chunks).toString());

    const toolName = inputData.tool_name || '';
    const toolInput = inputData.tool_input || {};

    // Rewrite paths from main repo root to worktree when running inside a worktree
    const rewrittenInput = rewriteWorktreePath(toolName, toolInput);
    if (rewrittenInput) {
      console.log(JSON.stringify({ tool_input: rewrittenInput }));
    }

    // Use the potentially-rewritten input for subsequent safety checks
    const effectiveInput = rewrittenInput || toolInput;

    // Check for .env file access (blocks access to sensitive environment files)
    if (isEnvFileAccess(toolName, effectiveInput)) {
      console.error(
        'BLOCKED: Access to .env files containing sensitive data is prohibited'
      );
      console.error('Use .env.sample for template files instead');
      process.exit(2); // Exit code 2 blocks tool call and shows error to Claude
    }

    // Check for dangerous rm -rf commands
    if (toolName === 'Bash') {
      const command = effectiveInput.command || '';

      // Block rm -rf commands with comprehensive pattern matching
      if (isDangerousRmCommand(command)) {
        console.error('BLOCKED: Dangerous rm command detected and prevented');
        process.exit(2); // Exit code 2 blocks tool call and shows error to Claude
      }
    }

    // Extract session_id
    const sessionId = inputData.session_id || 'unknown';

    // Ensure session log directory exists
    const logDir = ensureSessionLogDir(sessionId);
    const logPath = path.join(logDir, 'pre_tool_use.json');

    // Read existing log data or initialize empty list
    let logData: unknown[] = [];
    if (fs.existsSync(logPath)) {
      try {
        const content = fs.readFileSync(logPath, 'utf-8');
        logData = JSON.parse(content);
      } catch {
        logData = [];
      }
    }

    // Append new data
    logData.push({ ...inputData, tool_input: effectiveInput });

    // Write back to file with formatting
    fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));

    process.exit(0);
  } catch {
    // Handle any errors gracefully
    process.exit(0);
  }
}

main();
