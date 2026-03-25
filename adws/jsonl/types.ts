/**
 * Shared types for the JSONL schema/fixture system.
 * Defines the canonical envelope schema format and validation result types.
 */

/** A single field description within an envelope schema. */
export interface SchemaField {
  name: string;
  required: boolean;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
  /** Nested fields for object types. */
  fields?: SchemaField[];
}

/** Canonical envelope schema extracted from a real Claude CLI run. */
export interface EnvelopeSchema {
  /** ISO 8601 timestamp when the schema was probed. */
  probedAt: string;
  /** Map from message type name to its top-level field structure. */
  messageTypes: Record<string, SchemaField[]>;
}

/** Per-fixture validation result from the conformance checker. */
export interface ConformanceResult {
  /** Relative path to the fixture file. */
  fixturePath: string;
  /** True if the fixture passes all checks. */
  passed: boolean;
  /** Parse error if the JSONL was not valid JSON. */
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

/** Per-fixture result from the fixture updater. */
export interface UpdateResult {
  /** Relative path to the fixture file. */
  fixturePath: string;
  /** True if the fixture was modified. */
  changed: boolean;
  /** List of changes made (dot-path notation). */
  changes: string[];
}
