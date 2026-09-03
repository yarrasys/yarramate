// The interrogation engine as a runtime-neutral entry point.
//
// The `.` barrel reaches node:fs, node:path and node:child_process through
// workspace, source-store and attestation-staleness, so a consumer running
// inside a Worker or a Durable Object cannot take the engine from there
// without dragging Node in behind it. This subpath carries the pure engine
// alone: catalogue loading takes a WorkspaceSource, evaluation takes an
// in-memory graph, and a test pins the import graph free of Node builtins.
// The same shape the visual-graph projector uses (`./adapter/visual-graph`).
export {
  INTERROGATION_SEMANTICS_VERSION,
  composeCatalogues,
  qualifiedQuestionId,
  conditionInput,
  evaluateCatalogue,
  loadQuestionCatalogue,
  renderInterrogationReport,
  renderQuestion,
  type CatalogueCompositionResult,
  type ComposedCatalogue,
  type CatalogueCondition,
  type CatalogueEvidenceObservation,
  type CataloguePatternMembership,
  type CataloguePatternVacancy,
  type CatalogueInput,
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
