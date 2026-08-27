export {
  compileWorkspace,
  compileWorkspaceIncremental,
  compileWorkspaceWithProfileContext,
} from './compiler.js'
export { serializeSemanticGraph } from './graph.js'
export {
  isCoreConceptKindId,
  matrixEndpointAspects,
  permittedRelationshipKinds,
  relationshipPermitted,
  sourceKindsPermitting,
  targetKindsPermitting,
  type CoreConceptKindId,
} from './relationship-matrix.js'
export {
  ARCHIMATE_RELATIONSHIPS_SOURCE_SHA256,
  ARCHIMATE_RELATIONSHIPS_VERSION,
  CORE_CONCEPT_KIND_ORDER,
  RELATIONSHIP_LETTERS,
} from './archimate-relationships.generated.js'
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
  type EvidenceObservedValue,
  type EvidenceReport,
  type EvidenceResult,
  type EvidenceWorkspaceEvaluationResult,
} from './evidence.js'
export {
  constraintExpectsPredicate,
  reconcileEvidenceReports,
  type AssertedRelationship,
  type AttestationStaleness,
  type DeclaredSource,
  type EvidenceFinding,
  type ExpectationComparison,
  type ReconciliationFinding,
  type ReconciliationReport,
  type StaleAttestationFinding,
  type UnobservedExpectation,
} from './reconciliation.js'
export { deriveAttestationStaleness } from './attestation-staleness.js'
export {
  deriveArtifactCoverage,
  type ArtifactCoverage,
  type CoverageScopePattern,
} from './artifact-coverage.js'
export {
  buildRtm,
  renderRtmMarkdown,
  type RequirementsTraceabilityMatrix,
  type RtmAttestation,
  type RtmContextEntry,
  type RtmDescopedEntry,
  type RtmEvidenceVerdict,
  type RtmLineageEntry,
  type RtmRealizer,
  type RtmRow,
  type RtmSource,
} from './rtm.js'
export type {
  CompilationCache,
  CompilationResult,
  ContextualCompilationResult,
  IncrementalCompilationResult,
  ParsedWorkspaceSource,
  PatternMembership,
  Diagnostic,
  GraphClaim,
  GraphSource,
  SemanticGraph,
  ResolvedProfileContext,
  WorkspaceSource,
} from './compiler.js'
export {
  canonicalProjection,
  evaluateProjection,
  explainProjection,
  loadProjection,
  renderProjectionMarkdown,
  type ConceptFacet,
  type ProjectionExclusion,
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
export {
  createFileSystemStore,
  type PendingWrite,
  type SourceStore,
  type StoredSource,
  type WriteConflict,
  type WriteOutcome,
} from './source-store.js'
export {
  applyOperations,
  landOperations,
  posixDirectoryOf,
  type ApplyInput,
  type ApplyOutcome,
} from './apply-command.js'
export {
  connectableKinds,
  draftRelationship,
  proposeRelationshipId,
  stagedSubjectIds,
} from './relationship-drafting.js'
export { draftConcept, proposeConceptId } from './concept-drafting.js'
export {
  deletionBlockers,
  describeDeletion,
  draftDeletion,
  type DeletionBlocker,
} from './deletion-drafting.js'
export {
  INTERROGATION_SEMANTICS_VERSION,
  composeCatalogues,
  qualifiedQuestionId,
  evaluateCatalogue,
  loadQuestionCatalogue,
  renderInterrogationReport,
  renderQuestion,
  type CatalogueCondition,
  type CatalogueEvidenceObservation,
  type CataloguePatternMembership,
  type CatalogueLoadResult,
  type CatalogueQuestion,
  type CatalogueSelector,
  type InterrogationReport,
  type InterrogationSummary,
  type OpenSubject,
  type QuestionCatalogue,
  type ReportQuestion,
  type ReportWave,
} from './interrogate-command.js'
