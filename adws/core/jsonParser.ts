/** Handles cases where the output contains additional text around the JSON. */
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
 * Handles cases where the output contains additional text around the JSON.
 *
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
