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
  messageTypes: Record<string, SchemaField[]>;
}

export interface ConformanceResult {
  /** Relative path to the fixture file. */
  fixturePath: string;
  passed: boolean;
  parseError?: string;
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
