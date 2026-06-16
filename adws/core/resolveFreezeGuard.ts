export interface ResolveEditVerdict {
  permitted: boolean;
  flaggedFeature?: string;
}

export function evaluateResolveEdit(changedPaths: string[]): ResolveEditVerdict {
  for (const p of changedPaths) {
    if (p.endsWith('.feature')) {
      return { permitted: false, flaggedFeature: p };
    }
  }
  return { permitted: true };
}
