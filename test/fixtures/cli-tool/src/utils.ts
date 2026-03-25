/**
 * Utility functions for the fixture CLI tool.
 */

/**
 * Formats output with an optional prefix label.
 *
 * @param message - The message to format
 * @param label - Optional label to prepend (e.g. "INFO", "ERROR")
 * @returns Formatted string
 */
export function formatOutput(message: string, label?: string): string {
  return label ? `[${label}] ${message}` : message;
}
