/**
 * Shared JSON extraction and parsing utilities.
 * Consolidates the repeated JSON-from-output parsing pattern
 * from testAgent.ts, reviewAgent.ts, and issueClassifier.ts (sibling in core/).
 */

/**
 * Extracts and parses a JSON object from agent output.
 * Handles cases where the output contains additional text around the JSON.
 *
 * @param output - Raw string output that may contain a JSON object
 * @returns Parsed object of type T, or null on failure
 */
export function extractJson<T>(output: string): T | null {
  try {
    return JSON.parse(output);
  } catch {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Extracts and parses a JSON array from agent output.
 * Handles cases where the output contains additional text around the JSON.
 *
 * @param output - Raw string output that may contain a JSON array
 * @returns Parsed array of type T, or empty array on failure
 */
export function extractJsonArray<T>(output: string): T[] {
  try {
    return JSON.parse(output);
  } catch {
    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        return [];
      }
    }
    return [];
  }
}
