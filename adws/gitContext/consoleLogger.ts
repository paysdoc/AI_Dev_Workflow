/**
 * Default logger port (PRD story 17) — every level to stdout, matching the
 * host logger's single-stream behaviour so piped-output ordering is preserved
 * for callers that inject no logger of their own.
 */

import type { Logger } from './types';

export const consoleLogger: Logger = (message) => {
  console.log(message);
};
