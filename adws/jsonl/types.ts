export interface SchemaField {
  name: string;
  required: boolean;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
  /** Nested fields for object types. */
  fields?: SchemaField[];
}

export interface EnvelopeSchema {
  /** ISO 8601 timestamp when the schema was probed. */
  probedAt: string;
  /** Claude CLI version the probe-owned entries were last reconciled against. */
  cliVersion?: string;
  messageTypes: Record<string, SchemaField[]>;
}

export interface ConformanceResult {
  /** Relative path to the fixture file. */
  fixturePath: string;
  passed: boolean;
  parseError?: string;
  /** Number of non-empty lines read from the fixture. */
  lineCount: number;
  /** Required fields in the schema that are missing from the fixture (dot-path notation). */
  missingFields: string[];
  /** Fields present in the fixture but not in the schema (informational only). */
  extraFields: string[];
  /** Any errors encountered while feeding the fixture through parseJsonlOutput(). */
  parserErrors: string[];
  /** Any errors encountered while feeding the fixture through AnthropicTokenUsageExtractor. */
  extractorErrors: string[];
}

export interface UpdateResult {
  /** Relative path to the fixture file. */
  fixturePath: string;
  changed: boolean;
  /** List of changes made (dot-path notation). */
  changes: string[];
}

export interface LiveDriftReport {
  /** Probe-owned types the live run did not produce at all. */
  unobservedTypes: string[];
  /** Dot-paths (prefixed with the schema key) of required fields absent from the live envelope. */
  missingRequired: string[];
  /** Dot-paths of live fields the schema does not know (informational). */
  newFields: string[];
  /** Every schema key seen in the live run, including capture-owned and unknown ones. */
  observedTypes: string[];
}
