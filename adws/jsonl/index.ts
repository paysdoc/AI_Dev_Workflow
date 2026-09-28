export type { SchemaField, EnvelopeSchema, ConformanceResult, UpdateResult, LiveDriftReport } from './types';
export { probeClaudeJsonlSchema, checkClaudeJsonlSchema } from './schemaProbe';
export { checkConformance, formatConformanceReport } from './conformanceCheck';
export { updateFixtureEnvelopes } from './fixtureUpdater';
export {
  OPAQUE_OBJECT_FIELDS,
  schemaKeyFor,
  resolveSchemaFields,
  extractFieldSchema,
  findMissingFields,
  findExtraFields,
} from './schemaFields';
export { PROBE_OWNED_TYPES, extractObservedSchema, mergeObservedSchema, findLiveDrift } from './schemaMerge';
