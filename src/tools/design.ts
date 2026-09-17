import type { EvidenceObservation } from '../evidence.js'
import {
  evaluateCatalogue,
  renderQuestion,
  type CatalogueCondition,
  type InterrogationReport,
} from '../interrogate-command.js'
import { evaluateProjection } from '../projection.js'
import { renderBrief } from '../brief.js'
import {
  compileOf,
  composedCatalogueOf,
  evidenceDocumentsOf,
  guarded,
  refused,
  failed,
  type ToolResult,
  type ToolWorkspace,
} from './workspace.js'

/**
 * One step of the design interview (ADR 0156): what `yarramate design
 * <workspace> --json` prints, over a store. The CLI renders the human form
 * from the same core (`designStepDetailed`), so the two cannot drift.
 */

export interface DesignStep {
  readonly questionId: string
  readonly wave: string
  readonly scope: 'workspace' | 'subject'
  readonly authority: 'human' | 'agent' | 'either'
  readonly question: string
  readonly askPlain?: string
  readonly materiality: string
  readonly resolution: string
  /** The catalogue trigger, verbatim: the question's answer shape (#289). */
  readonly trigger: readonly CatalogueCondition[]
  readonly subject?: { readonly id: string; readonly name?: string }
  readonly remainingSubjects?: number
  readonly openSubjects?: readonly string[]
  readonly since?: string
}

/** The published `yarramate/design-step/v1` document. */
export interface DesignStepResult {
  readonly format: 'yarramate/design-step/v1'
  readonly workspace: string
  readonly catalogue: string
  readonly progress: {
    readonly questions: number
    readonly openQuestions: number
    readonly open: number
    readonly waves: readonly { readonly id: string; readonly open: number }[]
  }
  readonly step: DesignStep | null
  /** The subject's neighbourhood as a brief, when the step has a subject. */
  readonly slice?: string
}

export interface DesignStepOptions {
  /** A globally qualified subject id; narrows the interview to it. `refused` if unknown. */
  readonly subject?: string
}

/** The result plus the report it was cut from, for a renderer that needs wave state. */
export interface DesignStepDetailed {
  readonly result: DesignStepResult
  readonly report: Omit<InterrogationReport, 'workspace'>
}

// The top step is the first open question in wave order, then catalogue
// order within the wave; a subject-scoped question serves its first open
// subject and reports how many more share it. One question at a time is
// the discipline; everything else is a read (ask --open).
export const selectStep = (
  report: Omit<InterrogationReport, 'workspace'>,
  subjectFilter: string | undefined,
  askPlainById: ReadonlyMap<string, string>,
): DesignStep | null => {
  for (const wave of report.waves) {
    for (const question of wave.questions) {
      if (!question.open) continue
      const askPlainTemplate = askPlainById.get(question.id)
      if (question.subjects === undefined) {
        if (subjectFilter !== undefined) continue
        return {
          questionId: question.id,
          wave: wave.id,
          scope: 'workspace',
          authority: question.authority,
          question: question.question,
          ...(askPlainTemplate === undefined
            ? {}
            : { askPlain: askPlainTemplate.trim() }),
          materiality: question.materiality,
          resolution: question.resolution,
          trigger: question.trigger,
          ...(question.since === undefined ? {} : { since: question.since }),
        }
      }
      const subjects =
        subjectFilter === undefined
          ? question.subjects
          : question.subjects.filter(({ id }) => id === subjectFilter)
      const first = subjects[0]
      if (first === undefined) continue
      return {
        questionId: question.id,
        wave: wave.id,
        scope: 'subject',
        authority: question.authority,
        question: first.question,
        ...(askPlainTemplate === undefined
          ? {}
          : { askPlain: renderQuestion(askPlainTemplate, first.id, first.name) }),
        materiality: question.materiality,
        resolution: question.resolution,
        trigger: question.trigger,
        ...(question.since === undefined ? {} : { since: question.since }),
        subject: {
          id: first.id,
          ...(first.name === undefined ? {} : { name: first.name }),
        },
        ...(subjects.length > 1
          ? { remainingSubjects: subjects.length - 1 }
          : {}),
        openSubjects: subjects.map(({ id }) => id),
      }
    }
  }
  return null
}

export const designStepDetailed = (
  workspace: ToolWorkspace,
  options: DesignStepOptions = {},
): ToolResult<DesignStepDetailed> =>
  guarded(() => {
    // Compiled BEFORE the catalogue loads, so the catalogue can be checked
    // against the vocabulary its kinds are written against (#351). A
    // catalogue naming a kind its own profile does not have loads clean
    // otherwise, and the question it names is dead on arrival.
    const compilation = compileOf(workspace)
    if (!compilation.ok) return compilation
    const { compiled } = compilation

    const composed = composedCatalogueOf(workspace, compiled)
    if (!composed.ok) return failed(composed.diagnostics)

    // The evidence overlay rides along for the one condition that reads it
    // (unchallenged-evidence). A workspace declaring no evidence passes an
    // empty overlay, known to be empty, which keeps that condition quiet,
    // rather than an absent one.
    const evidence = evidenceDocumentsOf(workspace)
    if (!evidence.ok) return evidence
    const evidenceObservations: EvidenceObservation[] = evidence.documents.flatMap(
      ({ observations }) => observations,
    )

    const subjectFilter = options.subject
    if (subjectFilter !== undefined) {
      const known = new Set(compiled.graph.subjects.map(({ id }) => id))
      if (!known.has(subjectFilter)) {
        return refused(
          `Unknown subject identity: ${subjectFilter} (the compiled workspace declares ${known.size} subjects)`,
        )
      }
    }

    const report = evaluateCatalogue(
      composed.composed.catalogue,
      compiled.graph,
      compiled.profileContext,
      evidenceObservations,
      composed.composed.catalogues,
      compiled.patternMemberships,
      compiled.patternVacancies,
    )
    // Keyed by the QUALIFIED id, matching what the report carries.
    const askPlainById = new Map(
      composed.composed.catalogue.questions.flatMap((question) =>
        question.askPlain === undefined
          ? []
          : [[question.id, question.askPlain] as const],
      ),
    )
    const step = selectStep(report, subjectFilter, askPlainById)

    let slice: string | undefined
    if (step?.subject !== undefined) {
      const projection = evaluateProjection(
        compiled.graph,
        {
          format: 'yarramate/projection/v1',
          id: 'design-step',
          version: '0.0',
          query: {
            subjects: [step.subject.id],
            relationships: 'connected',
          },
          presentation: {
            title: step.subject.name ?? step.subject.id,
            description: `The neighbourhood of ${step.subject.id} as declared today.`,
            // Prose speaks every relationship (#563).
            showResponsibility: true,
          },
        },
        compiled.profileContext,
      )
      slice = renderBrief(
        projection,
        compiled.profileContext,
        undefined,
        compiled.graph.claims,
      )
    }

    const result: DesignStepResult = {
      format: 'yarramate/design-step/v1',
      workspace: workspace.workspace.id,
      catalogue: report.catalogue,
      progress: {
        questions: report.summary.questions,
        openQuestions: report.summary.openQuestions,
        open: report.summary.open,
        waves: report.waves.map((wave) => ({
          id: wave.id,
          open: wave.questions.reduce(
            (total, question) =>
              total +
              (question.open ? (question.subjects?.length ?? 1) : 0),
            0,
          ),
        })),
      },
      step,
      ...(slice === undefined ? {} : { slice }),
    }
    return { ok: true, result: { result, report } }
  })

/** `yarramate design <ws> [--subject] --json`, path-free. */
export const designStep = (
  workspace: ToolWorkspace,
  options: DesignStepOptions = {},
): ToolResult<DesignStepResult> => {
  const detailed = designStepDetailed(workspace, options)
  return detailed.ok ? { ok: true, result: detailed.result.result } : detailed
}
