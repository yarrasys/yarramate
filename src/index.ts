export { compileWorkspace } from './compiler.js'
export { serializeSemanticGraph } from './graph.js'
export {
  checkCoreContract,
  loadCoreContract,
  type CoreContract,
  type CoreContractCommand,
  type CoreContractFormat,
  type CoreContractLoadResult,
  type CoreContractSurface,
} from './core-contract.js'
export {
  compareArchitectureStates,
  type StateComparison,
  type StateComparisonIssue,
  type StateComparisonResult,
} from './architecture-state.js'
export {
  loadWorkspaceManifest,
  type ResolvedWorkspace,
  type WorkspaceManifest,
  type WorkspaceManifestResult,
} from './workspace.js'
export {
  evaluateEvidence,
  evaluateEvidenceWorkspace,
  loadEvidence,
  type EvidenceDocument,
  type EvidenceEvaluationResult,
  type EvidenceLoadResult,
  type EvidenceLocator,
  type EvidenceObservation,
  type EvidenceReport,
  type EvidenceResult,
  type EvidenceWorkspaceEvaluationResult,
} from './evidence.js'
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
