import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import {
  diagnosticJson,
  humanDiagnostics,
  usage,
  type CliResult,
} from './cli-support.js'
import {
  compileWorkspaceWithProfileContext,
  type Diagnostic,
} from './compiler.js'
import {
  evaluateCatalogue,
  loadQuestionCatalogue,
  renderQuestion,
  type InterrogationReport,
} from './interrogate-command.js'
import { evaluateProjection } from './projection.js'
import { renderBrief } from './brief.js'
import { loadWorkspaceManifest } from './workspace.js'

// The catalogue is internal to design: it ships inside the package,
// versioned with it, and harnesses never pass catalogue paths. The
// relative hop works from both src/ (dev) and dist/ (shipped).
const here = dirname(fileURLToPath(import.meta.url))
const shippedCataloguePath = join(
  here,
  '..',
  'catalogues',
  'core-enrichment.yaml',
)

interface DesignStep {
  readonly questionId: string
  readonly wave: string
  readonly scope: 'workspace' | 'subject'
  readonly authority: 'human' | 'agent' | 'either'
  readonly question: string
  readonly askPlain?: string
  readonly materiality: string
  readonly resolution: string
  readonly subject?: { readonly id: string; readonly name?: string }
  readonly remainingSubjects?: number
  readonly openSubjects?: readonly string[]
  readonly since?: string
}

interface DesignStepResult {
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
  readonly slice?: string
}

// The top step is the first open question in wave order, then catalogue
// order within the wave; a subject-scoped question serves its first open
// subject and reports how many more share it. One question at a time is
// the discipline; everything else is a read (ask --open).
const selectStep = (
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
        ...(question.since === undefined ? {} : { since: question.since }),
        subject: {
          id: first.id,
          ...(first.name === undefined ? {} : { name: first.name }),
        },
        ...(subjects.length > 1
          ? { remainingSubjects: subjects.length - 1 }
          : {}),
        // The full roster sharing this question (#116): when one policy
        // answer covers many subjects, the harness can collect it once
        // and land one apply batch instead of interviewing N times.
        openSubjects: subjects.map(({ id }) => id),
      }
    }
  }
  return null
}

export function runDesignCommand(
  options: readonly string[],
  cwd: string,
): CliResult {
  const json = options.includes('--json')
  // Facilitation is a rendering preference, not an interview mode: the
  // same step, slice, and envelope, with the plain phrasing preferred in
  // the human question line when the catalogue provides one.
  const facilitate = options.includes('--facilitate')
  let subjectFilter: string | undefined
  let cataloguePath: string | undefined
  const rest: string[] = []
  const withoutJson = options.filter(
    (option) => option !== '--json' && option !== '--facilitate',
  )
  for (let index = 0; index < withoutJson.length; index += 1) {
    const option = withoutJson[index]
    if (option === '--subject' || option === '--catalogue') {
      const value = withoutJson[index + 1]
      if (value === undefined || value.startsWith('-')) {
        return { exitCode: 2, stdout: '', stderr: usage }
      }
      if (option === '--subject') {
        if (subjectFilter !== undefined) {
          return { exitCode: 2, stdout: '', stderr: usage }
        }
        subjectFilter = value
      } else {
        if (cataloguePath !== undefined) {
          return { exitCode: 2, stdout: '', stderr: usage }
        }
        cataloguePath = value
      }
      index += 1
      continue
    }
    if (option === undefined || option.startsWith('-')) {
      return { exitCode: 2, stdout: '', stderr: usage }
    }
    rest.push(option)
  }
  const [workspacePath] = rest
  if (rest.length !== 1 || workspacePath === undefined) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }

  try {
    const manifestSource = readFileSync(resolve(cwd, workspacePath), 'utf8')
    if (
      parseDocument(manifestSource).get('format') !== 'yarramate/workspace/v1'
    ) {
      return {
        exitCode: 2,
        stdout: '',
        stderr:
          'design requires an explicit workspace manifest (yarramate/workspace/v1)\n',
      }
    }
    const failed = (diagnostics: readonly Diagnostic[]): CliResult => ({
      exitCode: 1,
      stdout: json
        ? diagnosticJson(diagnostics)
        : humanDiagnostics(diagnostics),
      stderr: '',
    })
    const loadedWorkspace = loadWorkspaceManifest(
      { path: workspacePath, source: manifestSource },
      cwd,
    )
    if (!loadedWorkspace.ok) return failed(loadedWorkspace.diagnostics)
    const workspace = loadedWorkspace.workspace

    const resolvedCataloguePath =
      cataloguePath === undefined
        ? shippedCataloguePath
        : resolve(cwd, cataloguePath)
    const loadedCatalogue = loadQuestionCatalogue({
      path: cataloguePath ?? resolvedCataloguePath,
      source: readFileSync(resolvedCataloguePath, 'utf8'),
    })
    if (!loadedCatalogue.ok) return failed(loadedCatalogue.diagnostics)

    const compilation = compileWorkspaceWithProfileContext(
      [...workspace.profiles, ...workspace.documents].map((path) => ({
        path,
        source: readFileSync(resolve(cwd, path), 'utf8'),
      })),
    )
    if (!compilation.ok) return failed(compilation.diagnostics)

    if (subjectFilter !== undefined) {
      const known = new Set(compilation.graph.subjects.map(({ id }) => id))
      if (!known.has(subjectFilter)) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `Unknown subject identity: ${subjectFilter} (the compiled workspace declares ${known.size} subjects)\n`,
        }
      }
    }

    const report = evaluateCatalogue(
      loadedCatalogue.catalogue,
      compilation.graph,
      compilation.profileContext,
    )
    const askPlainById = new Map(
      loadedCatalogue.catalogue.questions.flatMap((question) =>
        question.askPlain === undefined
          ? []
          : [[question.id, question.askPlain] as const],
      ),
    )
    const step = selectStep(report, subjectFilter, askPlainById)

    let slice: string | undefined
    if (step?.subject !== undefined) {
      const projection = evaluateProjection(
        compilation.graph,
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
          },
        },
        compilation.profileContext,
      )
      slice = renderBrief(projection, compilation.profileContext)
    }

    const result: DesignStepResult = {
      format: 'yarramate/design-step/v1',
      workspace: workspace.id,
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

    if (json) {
      return {
        exitCode: 0,
        stdout: `${JSON.stringify(result, null, 2)}\n`,
        stderr: '',
      }
    }

    const waveSummary = result.progress.waves
      .map(({ id, open }) => `${id} ${open} open`)
      .join(' · ')
    const lines: string[] = [
      `Design interview — workspace ${workspace.id} · catalogue ${report.catalogue}`,
      `Waves: ${waveSummary}`,
      '',
    ]
    if (step === null) {
      lines.push(
        subjectFilter === undefined
          ? 'Interview complete: no open questions. The model answers everything the catalogue asks.'
          : `Interview complete for ${subjectFilter}: no open questions touch it.`,
      )
    } else {
      // --facilitate prefers the workshop phrasing and falls back to the
      // standard one when a question has none; it never blocks.
      const asked =
        facilitate && step.askPlain !== undefined
          ? step.askPlain
          : step.question
      lines.push(
        `Q [${step.wave} · ${step.questionId}] (authority: ${step.authority})`,
        `  ${asked}`,
        `  Why it matters: ${step.materiality}`,
        `  How to answer: ${step.resolution}`,
      )
      if (step.remainingSubjects !== undefined) {
        lines.push(
          `  (${step.remainingSubjects} more subject${step.remainingSubjects === 1 ? '' : 's'} share${step.remainingSubjects === 1 ? 's' : ''} this question)`,
        )
      }
      if (slice !== undefined) {
        lines.push('', 'Subject slice:', '', slice.trimEnd())
      }
      lines.push(
        '',
        'Answer by updating the model (one atomic batch):',
        `  yarramate apply <operations.yaml> ${workspacePath}`,
        `Then re-run: yarramate design ${workspacePath}`,
      )
    }
    return { exitCode: 0, stdout: `${lines.join('\n')}\n`, stderr: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}
