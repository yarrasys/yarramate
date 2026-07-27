export { compileWorkspace } from './compiler.js'
export { serializeSemanticGraph } from './graph.js'
export type {
  CompilationResult,
  Diagnostic,
  GraphClaim,
  GraphSource,
  SemanticGraph,
  WorkspaceSource,
} from './compiler.js'
export {
  evaluateProjection,
  loadProjection,
  renderProjectionMarkdown,
} from './projection.js'
export {
  loadAdapterMapping,
  validateAdapterMapping,
  validateAdapterMappings,
  type AdapterMapping,
  type AdapterMappingLoadResult,
  type AdapterMappingValidationResult,
  type AdapterMappingsValidationResult,
  type AdapterSubjectMapping,
} from './adapter-mapping.js'
export type {
  LifecycleStatus,
  ProjectionDefinition,
  ProjectionLoadResult,
  ProjectionResult,
} from './projection.js'
