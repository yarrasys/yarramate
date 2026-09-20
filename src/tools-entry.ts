/**
 * `yarramate/tools`: the engine's path-free entry (ADR 0156).
 *
 * Every verb the CLI runs, as a function over a `SourceStore` and a
 * `ResolvedWorkspace`, importing no Node built-in, so the same tool that
 * answers `yarramate-mcp` on a laptop answers a hosted workspace inside a
 * Durable Object. The CLI commands are thin over these same functions;
 * `test/export-purity.test.ts` keeps the import graph free of Node.
 */
export {
  SHIPPED_CATALOGUE,
  MissingSourceError,
  type ToolWorkspace,
  type ToolResult,
  type ToolFailure,
} from './tools/workspace.js'
export {
  designStep,
  designStepDetailed,
  type DesignStep,
  type DesignStepDetailed,
  type DesignStepOptions,
  type DesignStepResult,
} from './tools/design.js'
export {
  askKinds,
  askNext,
  askOpen,
  askOrientation,
  askRoster,
  askSlice,
  candidateLimit,
  conceptEntries,
  resolveSeeds,
  type SeedCandidate,
  type SeedResolution,
  sliceProjection,
  type AskAdvice,
  type AskCompare,
  type AskKinds,
  type AskNext,
  type AskOpen,
  type AskOrientation,
  type AskResult,
  type AskResultBase,
  type AskRoster,
  type AskSlice,
  type AskWhere,
  type ConceptEntry,
  type NeighbourhoodOmission,
  type OpenQuestionRef,
  type RelationshipKindSummary,
  type RelationshipMatrixSummary,
  type RosterOptions,
  type SliceOptions,
  type SliceQuery,
} from './tools/ask.js'
export {
  checkSources,
  checkWorkspace,
  type CheckCounts,
  type CheckEvaluation,
  type CheckInput,
  type CheckOptions,
  type CheckResult,
} from './tools/check.js'
export {
  applyBatch,
  type ApplyResult,
  type OperationsInput,
} from './tools/apply.js'
export {
  exportBriefs,
  exportGraph,
  exportLikeC4,
  exportGovernance,
  exportMarkdown,
  exportResponsibility,
  exportRtm,
  exportWorkbook,
  type BriefsOptions,
  type ExportedBriefs,
} from './tools/export.js'
export {
  LOOP,
  STDIO_PROPERTIES,
  TOOL_CATALOGUE,
  TOOL_VERBS,
  instructionsFor,
  loopFor,
  runTool,
  toolCatalogueFor,
  toolVerbOf,
  type ToolDefinition,
  type ToolFile,
  type ToolName,
  type ToolNameFor,
  type ToolOutcome,
  type ToolVerb,
} from './tools/table.js'
export {
  DEFAULT_VENDOR_LINE,
  YARRAMATE_PRODUCT_NAME,
  YARRAMATE_TOOL_PREFIX,
  brandSlug,
  resolveBranding,
  type Branding,
  type BrandingLogo,
  type ResolvedBranding,
} from './branding.js'
export {
  patternToRegExp,
  resolveManifest,
  resolveWorkspaceFrom,
  type ExpandedMatch,
  type ManifestCategory,
  type PatternExpander,
  type ResolvedWorkspace,
  type WorkspaceManifest,
  type WorkspaceManifestResult,
} from './workspace-resolution.js'
export { sha256Hex } from './digest.js'
export {
  buildResponsibilityMatrix,
  renderResponsibilityMarkdown,
  type RaciLetter,
  type ResponsibilityCell,
  type ResponsibilityCellSource,
  type ResponsibilityMatrix,
  type ResponsibilityOptions,
  type ResponsibilityPerson,
  type ResponsibilityRow,
  type ResponsibilitySource,
} from './responsibility.js'
export {
  PEOPLE_KINDS,
  RESPONSIBILITY_KINDS,
  RESPONSIBILITY_PROFILE,
  responsibilityLetterOf,
  type ResponsibilityLetter,
} from './responsibility-kinds.js'
export {
  buildGovernanceLog,
  renderGovernanceMarkdown,
  type GovernanceLog,
  type GovernanceOptions,
  type GovernanceRef,
  type GovernanceReview,
  type GovernanceRow,
  type GovernanceSource,
} from './governance.js'
export {
  GOVERNANCE_KINDS,
  GOVERNANCE_PROFILE,
  REVIEW_TOPICS,
  governanceTypeOf,
  type GovernanceType,
} from './governance-kinds.js'
export type { NextSubject } from './next-command.js'
export type {
  PendingWrite,
  SourceStore,
  StoredSource,
  WriteConflict,
  WriteOutcome,
} from './source-store.js'
export type { Diagnostic, WorkspaceSource } from './compiler.js'
