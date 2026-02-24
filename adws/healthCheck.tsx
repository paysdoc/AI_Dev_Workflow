#!/usr/bin/env npx tsx
/**
 * Health Check Script for ADW System
 *
 * Usage: npx tsx adws/healthCheck.tsx <issueNumber>
 *
 * Performs comprehensive health checks:
 * 1. Validates all required environment variables
 * 2. Checks git repository configuration
 * 3. Tests Claude Code CLI functionality
 * 4. Returns structured results as HealthCheckResult
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from './core';
import {
  checkEnvironmentVariables,
  checkGitRepository,
  checkClaudeCodeCLI,
  checkGitHubCLI,
  checkDirectoryStructure,
  checkIssueNumber,
  execCommand,
} from './healthCheckChecks';

// Re-export for any external consumers
export type { CheckResult } from './healthCheckChecks';
export {
  checkEnvironmentVariables,
  checkGitRepository,
  checkClaudeCodeCLI,
  checkGitHubCLI,
  checkDirectoryStructure,
  checkIssueNumber,
  commandExists,
  execCommand,
} from './healthCheckChecks';

/**
 * Structure for health check results.
 */
export interface HealthCheckResult {
  success: boolean;
  timestamp: string;
  checks: Record<string, import('./healthCheckChecks').CheckResult>;
  warnings: string[];
  errors: string[];
}

/**
 * Prints usage information and exits.
 */
function printUsageAndExit(): never {
  console.error('Usage: npx tsx adws/healthCheck.tsx <issueNumber>');
  console.error('');
  console.error('Performs comprehensive health checks for the ADW system.');
  console.error('');
  console.error('Arguments:');
  console.error('  issueNumber  - GitHub issue number to validate');
  console.error('');
  console.error('Checks performed:');
  console.error('  - Environment variables (ANTHROPIC_API_KEY, etc.)');
  console.error('  - Git repository configuration');
  console.error('  - Claude Code CLI functionality');
  console.error('  - GitHub CLI (gh) functionality');
  console.error('  - Directory structure');
  console.error('  - Issue accessibility');
  process.exit(1);
}

/**
 * Parses command line arguments.
 */
function parseArguments(args: string[]): { issueNumber: number } {
  if (args.length < 1) {
    printUsageAndExit();
  }

  const issueNumber = parseInt(args[0], 10);
  if (isNaN(issueNumber)) {
    console.error(`Invalid issue number: ${args[0]}`);
    process.exit(1);
  }

  return { issueNumber };
}

/**
 * Main health check runner.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { issueNumber } = parseArguments(args);

  log('Starting ADW health check...', 'info');

  const result: HealthCheckResult = {
    success: true,
    timestamp: new Date().toISOString(),
    checks: {},
    warnings: [],
    errors: []
  };

  // Run all checks
  log('Checking environment variables...', 'info');
  result.checks.environmentVariables = checkEnvironmentVariables();

  log('Checking git repository...', 'info');
  result.checks.gitRepository = checkGitRepository();

  log('Checking Claude Code CLI...', 'info');
  result.checks.claudeCodeCLI = checkClaudeCodeCLI();

  log('Checking GitHub CLI...', 'info');
  result.checks.gitHubCLI = checkGitHubCLI();

  log('Checking directory structure...', 'info');
  result.checks.directoryStructure = checkDirectoryStructure();

  log(`Checking issue #${issueNumber}...`, 'info');
  result.checks.issueAccessibility = checkIssueNumber(issueNumber);

  // Collect warnings and errors
  for (const [checkName, checkResult] of Object.entries(result.checks)) {
    if (checkResult.error) {
      result.errors.push(`${checkName}: ${checkResult.error}`);
    }
    if (checkResult.warning) {
      result.warnings.push(`${checkName}: ${checkResult.warning}`);
    }
    if (!checkResult.success) {
      result.success = false;
    }
  }

  // Output results in human-readable format
  console.log('\n' + '='.repeat(60));
  console.log('ADW Health Check Results');
  console.log('='.repeat(60) + '\n');

  // Environment Variables
  const envCheck = result.checks.environmentVariables;
  console.log(`${envCheck.success ? '✅' : '❌'} Environment Variables`);
  if (envCheck.success) {
    const details = envCheck.details as { required: string[]; optional: string[] };
    console.log(`   Required: ${details.required.join(', ')}`);
    if (details.optional.length > 0) {
      console.log(`   Optional: ${details.optional.join(', ')}`);
    }
  } else {
    console.log(`   Error: ${envCheck.error}`);
  }

  // Git Repository
  const gitCheck = result.checks.gitRepository;
  console.log(`${gitCheck.success ? '✅' : '❌'} Git Repository`);
  if (gitCheck.success) {
    const details = gitCheck.details as { currentBranch: string; remotes: string[]; userName?: string; userEmail?: string };
    console.log(`   Branch: ${details.currentBranch}`);
    console.log(`   Remotes: ${details.remotes.join(', ') || 'none'}`);
    if (details.userName) {
      console.log(`   User: ${details.userName} <${details.userEmail}>`);
    }
    if (gitCheck.warning) {
      console.log(`   ⚠️  Warning: ${gitCheck.warning}`);
    }
  } else {
    console.log(`   Error: ${gitCheck.error}`);
  }

  // Claude Code CLI
  const claudeCheck = result.checks.claudeCodeCLI;
  console.log(`${claudeCheck.success ? '✅' : '❌'} Claude Code CLI`);
  if (claudeCheck.success) {
    const details = claudeCheck.details as { configuredPath: string; version: string; inPath: boolean };
    console.log(`   Path: ${details.configuredPath}`);
    console.log(`   Version: ${details.version}`);
    console.log(`   In PATH: ${details.inPath ? 'yes' : 'no'}`);
  } else {
    console.log(`   Error: ${claudeCheck.error}`);
  }

  // GitHub CLI
  const ghCheck = result.checks.gitHubCLI;
  console.log(`${ghCheck.success ? '✅' : '❌'} GitHub CLI`);
  if (ghCheck.success) {
    const details = ghCheck.details as { installed: boolean; authenticated: boolean; hasGitHubPAT: boolean };
    console.log(`   Installed: ${details.installed ? 'yes' : 'no'}`);
    console.log(`   Authenticated: ${details.authenticated ? 'yes' : 'no'}`);
    console.log(`   GITHUB_PAT set: ${details.hasGitHubPAT ? 'yes' : 'no'}`);
    if (ghCheck.warning) {
      console.log(`   ⚠️  Warning: ${ghCheck.warning}`);
    }
  } else {
    console.log(`   Error: ${ghCheck.error}`);
  }

  // Directory Structure
  const dirCheck = result.checks.directoryStructure;
  console.log(`${dirCheck.success ? '✅' : '❌'} Directory Structure`);
  if (dirCheck.success) {
    const details = dirCheck.details as { logsDir: string; logsDirExists: boolean; specsDir: string; specsDirExists: boolean; claudeDirExists: boolean; commandsDirExists: boolean };
    console.log(`   Logs dir: ${details.logsDir} ${details.logsDirExists ? '(exists)' : '(will be created)'}`);
    console.log(`   Specs dir: ${details.specsDir} ${details.specsDirExists ? '(exists)' : '(will be created)'}`);
    console.log(`   .claude dir: ${details.claudeDirExists ? 'exists' : 'missing'}`);
    console.log(`   .claude/commands: ${details.commandsDirExists ? 'exists' : 'missing'}`);
    if (dirCheck.warning) {
      console.log(`   ⚠️  Warning: ${dirCheck.warning}`);
    }
  } else {
    console.log(`   Error: ${dirCheck.error}`);
  }

  // Issue Accessibility
  const issueCheck = result.checks.issueAccessibility;
  console.log(`${issueCheck.success ? '✅' : '❌'} Issue #${issueNumber}`);
  if (issueCheck.success) {
    const details = issueCheck.details as { title: string; state: string };
    console.log(`   Title: ${details.title}`);
    console.log(`   State: ${details.state}`);
    // Get repo URL for the issue link
    const repoUrl = execCommand('gh repo view --json url -q .url');
    if (repoUrl) {
      console.log(`   URL: ${repoUrl}/issues/${issueNumber}`);
    }
  } else {
    console.log(`   Error: ${issueCheck.error}`);
  }

  // Summary
  console.log('\n' + '-'.repeat(60));
  if (result.success) {
    console.log('✅ All health checks passed!');
  } else {
    console.log('❌ Health check failed!');
    console.log(`   ${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
  }
  console.log('-'.repeat(60) + '\n');

  // Also write to a JSONL file for programmatic consumption
  const outputFile = path.join(process.cwd(), 'healthCheck.jsonl');
  fs.writeFileSync(outputFile, JSON.stringify(result) + '\n');
  log(`Results written to: ${outputFile}`, 'info');

  process.exit(result.success ? 0 : 1);
}

main();
