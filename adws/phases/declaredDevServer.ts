import * as fs from 'fs';
import * as path from 'path';
import { declaredDevServerCommand } from '../core/baselineGate';

/**
 * The server the repository declares: the base branch and the issue branch share this one definition, so a
 * failed start on the issue branch is only ever held against a server that the baseline could have started.
 */
export function readDeclaredDevServer(checkoutPath: string): string | null {
  try {
    return declaredDevServerCommand(fs.readFileSync(path.join(checkoutPath, '.adw', 'commands.md'), 'utf-8'));
  } catch {
    return null;
  }
}
