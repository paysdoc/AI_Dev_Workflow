export function formatOutput(message: string, label?: string): string {
  return label ? `[${label}] ${message}` : message;
}
