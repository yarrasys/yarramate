import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseDocument } from 'yaml'
import { compareArchitectureStates } from './architecture-state.js'
import { renderBrief } from './brief.js'
import { deriveChangedSubjects } from './changed.js'
import {
  diagnosticJson,
  humanDiagnostics,
  usage,
  type CliResult,
} from './cli-support.js'
import type { Diagnostic } from './compiler.js'
import { evaluateEvidenceWorkspace, type EvidenceObservation } from './evidence.js'
import {
  evaluateCatalogue,
  renderInterrogationReport,
} from './interrogate-command.js'
import { coverageClause, type NextSubject } from './next-command.js'
import { conceptKinds, relationshipPolicies } from './profile.js'
import {
  ARCHIMATE_RELATIONSHIPS_VERSION,
  CORE_CONCEPT_KIND_ORDER,
} from './archimate-relationships.generated.js'
import { matrixEndpointAspects } from './relationship-matrix.js'
import { evaluateProjection, loadProjection } from './projection.js'
import {
  reconcileEvidenceReports,
  type ReconciliationFinding,
  type ReconciliationReport,
} from './reconciliation.js'
import { createFileSystemStore } from './source-store.js'
import { posixDirectoryOf } from './apply-command.js'
import { loadWorkspaceManifest } from './workspace.js'
import {
  askKinds,
  askNext,
  askOpen,
  askOrientationDetailed,
  askRosterDetailed,
  askSlice,
  conceptEntries,
  defaultNeighbourCap,
  renderSlice,
  resolveSeeds,
  sliceProjection,
  type AskResult,
  type NeighbourhoodOmission,
  type OpenQuestionRef,
} from './tools/ask.js'
import {
  compileOf,
  composedCatalogueOf,
  evidenceDocumentsOf,
  readSource,
  type ToolFailure,
  type ToolWorkspace,
} from './tools/workspace.js'

// The modes live in `tools/ask.ts` (ADR 0156): this command parses
// arguments, resolves the manifest against the filesystem, runs the same
// store-backed cores the hosted server runs, and renders the human forms.
// The git-derived review slice, `--advise`, `--where` and `--compare` are
// the CLI's own and compose the same helpers.

const plural = (count: number, singular: string) =>
  `${count} ${count === 1 ? singular : `${singular}s`}`

const reconciliationLine = (
  summary: ReconciliationReport['summary'],
): string =>
  `Reconciliation: ${plural(summary.observations, 'observation')}, ` +
  `${summary.confirmed} confirmed, ` +
  `${plural(summary.findings, 'finding')}` +
  (summary.findings > 0
    ? ` (${summary.contradicted} contradicted, ` +
      `${summary.unknown} unknown, ` +
      `${summary.notObserved} not observed)`
    : '') +
  (summary.subjectsWithoutEvidence > 0
    ? `, ${plural(summary.subjectsWithoutEvidence, 'current subject')} without evidence`
    : '')

const plannedLines = (subjects: readonly NextSubject[]): readonly string[] => {
  if (subjects.length === 0) return ['  none']
  const width = Math.max(...subjects.map(({ id }) => id.length))
  return subjects.map((subject) => {
    const clauses = [
      ...(subject.requiredBy.length > 0
        ? [`<- required by ${subject.requiredBy.join(', ')}`]
        : []),
      coverageClause(subject.evidence),
      ...(subject.cycle === true ? ['dependency cycle'] : []),
    ]
    return `  ${subject.id.padEnd(width)}  ${clauses.join('; ')}`
  })
}

// The honesty line, in the budgeted-ladder voice (ADR 0042): what was
// dropped is named, and so is the way to widen.
const neighbourhoodLine = (
  neighbourhood: NeighbourhoodOmission,
): string =>
  `[neighbours ${neighbourhood.cap}: ${neighbourhood.omitted} of ` +
  `${neighbourhood.kept + neighbourhood.omitted} neighbours omitted — ` +
  `raise --neighbours or pass --neighbours 0 for the full neighbourhood]`

/**
 * The JSON the CLI prints is the published document without the tool
 * entry's additive `rendered` text (ADR 0156): the CLI has a human form
 * for that, and its `--json` stays what it was.
 */
const withoutRendered = (result: AskResult): AskResult => {
  if (result.mode !== 'slice' || result.rendered === undefined) return result
  const { rendered: _rendered, ...rest } = result
  return rest
}

export function runAskCommand(
  options: readonly string[],
  cwd: string,
): CliResult {
  let json = false
  let subjects = false
  let next = false
  let open = false
  let kinds = false
  let advise = false
  let where = false
  let compare: readonly [string, string] | undefined
  let changed: string | undefined
  let budget: number | undefined
  let neighbours: number | undefined
  let kindFilter: string | undefined
  let statusFilter: string | undefined
  let cataloguePath: string | undefined
  const positionals: string[] = []
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index]
    if (option === '--json') {
      json = true
      continue
    }
    if (option === '--subjects') {
      subjects = true
      continue
    }
    if (option === '--next') {
      next = true
      continue
    }
    if (option === '--open') {
      open = true
      continue
    }
    if (option === '--kinds') {
      kinds = true
      continue
    }
    if (option === '--advise') {
      advise = true
      continue
    }
    if (option === '--where') {
      where = true
      continue
    }
    if (option === '--compare') {
      const from = options[index + 1]
      const to = options[index + 2]
      if (
        compare !== undefined ||
        from === undefined ||
        to === undefined ||
        from.startsWith('-') ||
        to.startsWith('-')
      ) {
        return { exitCode: 2, stdout: '', stderr: usage }
      }
      compare = [from, to]
      index += 2
      continue
    }
    if (
      option === '--budget' ||
      option === '--neighbours' ||
      option === '--kind' ||
      option === '--status' ||
      option === '--catalogue' ||
      option === '--changed'
    ) {
      const value = options[index + 1]
      if (value === undefined || value.startsWith('-')) {
        return { exitCode: 2, stdout: '', stderr: usage }
      }
      if (option === '--budget') {
        if (budget !== undefined || !/^[1-9][0-9]*$/.test(value)) {
          return { exitCode: 2, stdout: '', stderr: usage }
        }
        budget = Number(value)
      } else if (option === '--neighbours') {
        if (neighbours !== undefined || !/^(0|[1-9][0-9]*)$/.test(value)) {
          return { exitCode: 2, stdout: '', stderr: usage }
        }
        neighbours = Number(value)
      } else if (option === '--changed') {
        if (changed !== undefined) {
          return { exitCode: 2, stdout: '', stderr: usage }
        }
        changed = value
      } else if (option === '--kind') {
        if (kindFilter !== undefined) {
          return { exitCode: 2, stdout: '', stderr: usage }
        }
        kindFilter = value
      } else if (option === '--status') {
        if (
          statusFilter !== undefined ||
          !['planned', 'current', 'retired'].includes(value)
        ) {
          return { exitCode: 2, stdout: '', stderr: usage }
        }
        statusFilter = value
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
    positionals.push(option)
  }

  const [workspacePath, ...query] = positionals
  const exclusiveModes = [
    subjects,
    next,
    open,
    kinds,
    compare !== undefined,
  ].filter(Boolean).length
  if (
    workspacePath === undefined ||
    exclusiveModes > 1 ||
    (advise && exclusiveModes > 0) ||
    (advise && query.length === 0) ||
    (where &&
      (exclusiveModes > 0 ||
        advise ||
        changed !== undefined ||
        budget !== undefined ||
        neighbours !== undefined ||
        query.length === 0)) ||
    (query.length > 0 && exclusiveModes > 0) ||
    (changed !== undefined &&
      (query.length > 0 || exclusiveModes > 0 || advise)) ||
    ((kindFilter !== undefined || statusFilter !== undefined) && !subjects) ||
    (cataloguePath !== undefined && !open && !advise) ||
    (budget !== undefined &&
      (json || (query.length === 0 && !advise && changed === undefined))) ||
    (neighbours !== undefined &&
      query.length === 0 &&
      !advise &&
      changed === undefined)
  ) {
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
          'ask requires an explicit workspace manifest (yarramate/workspace/v1)\n',
      }
    }
    const failed = (diagnostics: readonly Diagnostic[]): CliResult => ({
      exitCode: 1,
      stdout: json
        ? diagnosticJson(diagnostics)
        : humanDiagnostics(diagnostics),
      stderr: '',
    })
    const failedTool = (failure: ToolFailure): CliResult =>
      failure.reason === 'diagnostics'
        ? failed(failure.diagnostics)
        : { exitCode: 2, stdout: '', stderr: `${failure.message}\n` }
    const loadedWorkspace = loadWorkspaceManifest(
      { path: workspacePath, source: manifestSource },
      cwd,
    )
    if (!loadedWorkspace.ok) return failed(loadedWorkspace.diagnostics)
    const workspace = loadedWorkspace.workspace
    const tool: ToolWorkspace = {
      store: createFileSystemStore(cwd),
      workspace,
      manifestDirectory: posixDirectoryOf(workspacePath),
      ...(cataloguePath === undefined
        ? {}
        : {
            catalogue: {
              path: cataloguePath,
              source: readFileSync(resolve(cwd, cataloguePath), 'utf8'),
            },
          }),
    }

    const emit = (result: AskResult, human: string, exitCode: 0 | 1 = 0) =>
      json
        ? {
            exitCode,
            stdout: `${JSON.stringify(withoutRendered(result), null, 2)}\n`,
            stderr: '',
          }
        : { exitCode, stdout: human, stderr: '' }

    if (
      query.length === 0 &&
      !subjects &&
      !next &&
      !open &&
      !kinds &&
      !advise &&
      compare === undefined &&
      changed === undefined
    ) {
      const oriented = askOrientationDetailed(tool)
      if (!oriented.ok) return failedTool(oriented)
      const { result, report } = oriented.result
      if (!result.ok || report === undefined) {
        return emit(
          result,
          `Workspace ${workspace.id}: check failing\n` +
            `Diagnostics: ${plural(result.check.diagnostics.length, 'error')}; run \`yarramate check ${workspacePath}\` for details\n`,
          1,
        )
      }
      const { planned, current, retired } = result.backlog
      const counted = result.check.counted
      const lines: string[] = [
        `Workspace ${workspace.id}: check ok` +
          (counted === undefined
            ? ''
            : ` (${plural(counted.concepts, 'concept')}, ` +
              `${plural(counted.relationships, 'relationship')}, ` +
              `${plural(counted.states, 'state')}, ` +
              `${plural(counted.documents, 'document')})`),
      ]
      if (result.reconciliation !== undefined) {
        lines.push(reconciliationLine(result.reconciliation))
      }
      // "No open questions" and "no wave has opened" are different facts
      // (#334): only the first is completion.
      const askedAnything = report.waves.some(
        (wave) => wave.questions.length > 0,
      )
      lines.push(
        report.summary.open === 0
          ? askedAnything
            ? `Design interview complete (catalogue ${report.catalogue}): no open questions.`
            : `Design interview not started (catalogue ${report.catalogue}): no wave has opened yet.`
          : `Design interview: ${plural(report.summary.open, 'open question')} (catalogue ${report.catalogue}) — continue: yarramate design ${workspacePath}`,
        '',
        'Backlog — planned, dependency order:',
        ...plannedLines(planned),
        '',
        `Current: ${plural(current.length, 'subject')} · Retired: ${retired.length} ` +
          `(roster: yarramate ask ${workspacePath} --subjects)`,
      )
      return emit(result, `${lines.join('\n')}\n`)
    }

    if (subjects) {
      const rostered = askRosterDetailed(tool, {
        ...(kindFilter === undefined ? {} : { kind: kindFilter }),
        ...(statusFilter === undefined
          ? {}
          : { status: statusFilter as 'planned' | 'current' | 'retired' }),
      })
      if (!rostered.ok) return failedTool(rostered)
      const { result, entries } = rostered.result
      const filtered = result.subjects
      const lines = [
        `Subjects in workspace ${workspace.id}: ${filtered.length} of ${entries.length}`,
      ]
      if (filtered.length > 0) {
        const width = Math.max(...filtered.map(({ id }) => id.length))
        const kindWidth = Math.max(
          ...filtered.map(
            ({ kind }) => (kind.split('#')[1] ?? kind).length,
          ),
        )
        for (const entry of filtered) {
          const kind = entry.kind.split('#')[1] ?? entry.kind
          const description =
            entry.description === undefined
              ? ''
              : ` — ${
                  entry.description.length > 100
                    ? `${entry.description.slice(0, 100)}…`
                    : entry.description
                }`
          lines.push(
            `  ${entry.id.padEnd(width)}  ${kind.padEnd(kindWidth)}  ` +
              `${entry.name ?? entry.id}` +
              `${entry.status === undefined ? '' : ` (${entry.status})`}` +
              description,
          )
        }
      }
      return emit(result, `${lines.join('\n')}\n`)
    }

    if (kinds) {
      const kinded = askKinds(tool)
      if (!kinded.ok) return failedTool(kinded)
      const result = kinded.result
      const lines: string[] = [
        `Declarable kinds — core profile yarramate/core@0.1`,
        '',
        'Concept kinds (by layer):',
      ]
      const layers = [...new Set(conceptKinds.map(({ layer }) => layer))]
      for (const layer of layers) {
        const inLayer = conceptKinds.filter(
          (candidate) => candidate.layer === layer,
        )
        lines.push(
          `  ${layer}: ${inLayer.map(({ id }) => id).join(', ')}`,
        )
      }
      lines.push('', 'Relationship kinds:')
      for (const policy of relationshipPolicies) {
        const source = [...matrixEndpointAspects(policy.id, 'source')].join('|')
        const target = [...matrixEndpointAspects(policy.id, 'target')].join('|')
        lines.push(`  ${policy.id} — ${policy.intent} [${source} -> ${target}]`)
      }
      lines.push(
        '',
        `Relationship admissibility: ArchiMate ${ARCHIMATE_RELATIONSHIPS_VERSION} kind-to-kind table (${CORE_CONCEPT_KIND_ORDER.length} kinds; see relationshipMatrix in --json)`,
      )
      if (result.extensions.length > 0) {
        lines.push('', 'Profile extensions in this workspace:')
        for (const extension of result.extensions) {
          lines.push(
            `  ${extension.id} (${extension.type})` +
              (extension.lineage.length > 0
                ? ` -> ${extension.lineage.join(' -> ')}`
                : ''),
          )
        }
      }
      return emit(result, `${lines.join('\n')}\n`)
    }

    if (next) {
      const nexted = askNext(tool)
      if (!nexted.ok) return failedTool(nexted)
      const result = nexted.result
      const ordered = result.subjects
      const human =
        ordered.length === 0
          ? `No planned subjects in workspace ${workspace.id}.\n`
          : `${[
              `Planned subjects in workspace ${workspace.id} (dependency order):`,
              ...plannedLines(ordered),
            ].join('\n')}\n`
      return emit(result, human)
    }

    if (open) {
      const opened = askOpen(tool)
      if (!opened.ok) return failedTool(opened)
      return emit(opened.result, renderInterrogationReport(opened.result.report))
    }

    // Everything below compiles once and reads the graph directly.
    const compilation = compileOf(tool)
    if (!compilation.ok) return failedTool(compilation)
    const { compiled } = compilation
    const graph = compiled.graph
    const entries = conceptEntries(graph)

    if (compare !== undefined) {
      const comparison = compareArchitectureStates(graph, ...compare)
      if (!comparison.ok) {
        return {
          exitCode: 2,
          stdout: '',
          stderr: `${comparison.issues.map(({ message }) => message).join('\n')}\n`,
        }
      }
      const result: AskResult = {
        format: 'yarramate/ask-result/v1',
        workspace: workspace.id,
        mode: 'compare',
        comparison: comparison.comparison,
      }
      const { added, removed, retained } = comparison.comparison
      const lines = [
        `States ${compare[0]} -> ${compare[1]}: ` +
          `${added.length} added, ${removed.length} removed, ${retained.length} retained`,
      ]
      if (added.length > 0) {
        lines.push('Added:', ...added.map(({ id, type }) => `  ${id} (${type})`))
      }
      if (removed.length > 0) {
        lines.push(
          'Removed:',
          ...removed.map(({ id, type }) => `  ${id} (${type})`),
        )
      }
      return emit(result, `${lines.join('\n')}\n`)
    }

    if (changed !== undefined) {
      // --changed: the review slice (ADR 0065). Git says what changed; the
      // engine maps changed lines to subjects and renders their connected
      // neighbourhood, plus a coverage note when a changed subject appears
      // in no authored projection.
      const documentIdByPath = new Map(
        graph.documents.map(({ id, source }) => [source, id]),
      )
      const derived = deriveChangedSubjects(
        cwd,
        changed,
        workspace.documents.map((path) => ({
          ...readSource(tool, path),
          documentId: documentIdByPath.get(path) ?? path,
        })),
      )
      if (!derived.ok) {
        return { exitCode: 2, stdout: '', stderr: `${derived.message}\n` }
      }
      const endpoints = new Set<string>()
      for (const relationshipId of derived.changed.relationships) {
        const claim = graph.claims.find(
          (candidate) =>
            candidate.id === relationshipId && 'ref' in candidate.object,
        )
        if (claim !== undefined && 'ref' in claim.object) {
          endpoints.add(claim.subject)
          endpoints.add(claim.object.ref)
        }
      }
      const seeds = [
        ...new Set([...derived.changed.concepts, ...endpoints]),
      ].sort()
      const changedIds = [
        ...derived.changed.concepts,
        ...derived.changed.relationships,
      ]

      const covered = new Set<string>()
      for (const projectionPath of workspace.projections) {
        const loaded = loadProjection(readSource(tool, projectionPath))
        if (!loaded.ok) continue
        const membership = evaluateProjection(
          graph,
          loaded.projection,
          compiled.profileContext,
          compiled.patternMemberships,
        )
        for (const subject of membership.subjects) {
          covered.add(subject.id)
        }
      }
      const uncovered = changedIds.filter((id) => !covered.has(id))
      const coverage = {
        projections: workspace.projections.length,
        uncovered,
      }

      const { result: evaluated, neighbourhood } = sliceProjection(
        graph,
        seeds,
        `Review slice ${changed}`,
        compiled.profileContext,
        neighbours ?? defaultNeighbourCap,
      )
      const result: AskResult = {
        format: 'yarramate/ask-result/v1',
        workspace: workspace.id,
        mode: 'slice',
        addressing: 'changed',
        seeds,
        changed: derived.changed,
        coverage,
        ...(neighbourhood === undefined ? {} : { neighbourhood }),
        result: evaluated,
      }
      if (changedIds.length === 0) {
        return emit(
          result,
          `No model subjects changed in ${changed}.\n`,
        )
      }
      const rendered = renderSlice(evaluated, compiled, budget)
      const lines = [
        `Review slice ${changed} — ${plural(derived.changed.concepts.length, 'concept')}, ` +
          `${plural(derived.changed.relationships.length, 'relationship')} changed (workspace ${workspace.id})`,
        '',
        rendered.trimEnd(),
        ...(neighbourhood === undefined
          ? []
          : ['', neighbourhoodLine(neighbourhood)]),
        '',
        uncovered.length === 0
          ? `Review coverage: every changed subject appears in at least one of the ${coverage.projections} authored projections.`
          : `Review coverage: ${uncovered.length} of ${changedIds.length} changed subjects appear in no authored projection:` +
            `\n${uncovered.map((id) => `  ${id}`).join('\n')}`,
      ]
      return emit(result, `${lines.join('\n')}\n`)
    }

    // A single term that names a projection file is that projection's
    // slice; everything else is free text or subject ids.
    const soleTerm = query.length === 1 ? query[0] : undefined
    const projectionCandidate =
      soleTerm !== undefined &&
      !advise &&
      !where &&
      existsSync(resolve(cwd, soleTerm))
        ? resolve(cwd, soleTerm)
        : undefined
    if (
      projectionCandidate !== undefined &&
      parseDocument(readFileSync(projectionCandidate, 'utf8')).get(
        'format',
      ) === 'yarramate/projection/v1'
    ) {
      const sliced = askSlice(
        tool,
        { projection: soleTerm! },
        {
          ...(budget === undefined ? {} : { budget }),
          ...(neighbours === undefined ? {} : { neighbours }),
        },
      )
      if (!sliced.ok) return failedTool(sliced)
      return emit(sliced.result, sliced.result.rendered ?? '')
    }

    const topic = query.join(' ')
    const resolution = resolveSeeds(query, entries)
    if (resolution.seeds.length === 0) {
      return {
        exitCode: 1,
        stdout: '',
        stderr:
          `No concepts match "${topic}" ` +
          `(searched ${plural(entries.length, 'concept')} by id, name, and description). ` +
          `List the roster: yarramate ask ${workspacePath} --subjects\n`,
      }
    }
    if (where) {
      const evidence = evidenceDocumentsOf(tool)
      if (!evidence.ok) return failedTool(evidence)
      const evidenceDocuments = evidence.documents
      const subjectOf = (observation: EvidenceObservation): string =>
        'subject' in observation
          ? observation.subject
          : (observation.claim.split('~')[0] ?? observation.claim)
      const entriesBySeed = resolution.seeds.map((seed) => ({
        subject: seed,
        observations: [
          ...new Map(
            evidenceDocuments
              .flatMap((document) =>
                document.observations
                  .filter((observation) => subjectOf(observation) === seed)
                  .map((observation) => ({
                    uri: observation.evidence.uri,
                    result: observation.result,
                    provider: document.provider,
                    ...(observation.evidence.message === undefined
                      ? {}
                      : { message: observation.evidence.message }),
                  })),
              )
              .map(
                (entry) =>
                  [
                    `${entry.uri}\u0000${entry.result}\u0000${entry.provider}\u0000${entry.message ?? ''}`,
                    entry,
                  ] as const,
              ),
          ).values(),
        ].sort(
          (left, right) =>
            left.uri.localeCompare(right.uri) ||
            left.result.localeCompare(right.result),
        ),
      }))
      const located = entriesBySeed.filter(
        ({ observations }) => observations.length > 0,
      )
      const unobserved = entriesBySeed
        .filter(({ observations }) => observations.length === 0)
        .map(({ subject }) => subject)
      const note =
        workspace.evidence.length === 0
          ? 'This workspace declares no evidence overlay, so no location is verified. For code locations, use your search tools; author evidence observations to make locations verifiable.'
          : 'Locations above are verified by evidence overlays. Subjects listed as unobserved are modeled but unlocated. For code outside the model, use your search tools or a code index.'
      const result: AskResult = {
        format: 'yarramate/ask-result/v1',
        workspace: workspace.id,
        mode: 'where',
        addressing: resolution.addressing,
        topic,
        seeds: resolution.seeds,
        matched: resolution.matched,
        located,
        coverage: { unobserved, note },
      }
      const lines: string[] = [
        `Where: "${topic}" — ${plural(resolution.matched, 'concept')} matched` +
          (resolution.matched > resolution.seeds.length
            ? `, seeded from the top ${resolution.seeds.length}`
            : '') +
          `: ${resolution.seeds.join(', ')}`,
        '',
      ]
      for (const entry of located) {
        lines.push(`  ${entry.subject}`)
        for (const observation of entry.observations) {
          lines.push(
            `    ${observation.result}  ${observation.uri}  (${observation.provider})`,
          )
          if (observation.message !== undefined) {
            lines.push(`      ${observation.message}`)
          }
        }
      }
      if (located.length === 0) {
        lines.push('  no verified locations')
      }
      if (unobserved.length > 0) {
        lines.push(
          '',
          `  unobserved — modeled, no evidence: ${unobserved.join(', ')}`,
        )
      }
      lines.push('', note)
      return emit(result, `${lines.join('\n')}\n`)
    }

    const { result: evaluated, neighbourhood } = sliceProjection(
      graph,
      resolution.seeds,
      topic,
      compiled.profileContext,
      neighbours ?? defaultNeighbourCap,
    )

    if (!advise) {
      const result: AskResult = {
        format: 'yarramate/ask-result/v1',
        workspace: workspace.id,
        mode: 'slice',
        addressing: resolution.addressing,
        topic,
        seeds: resolution.seeds,
        matched: resolution.matched,
        // The same document the tools entry emits, field for field (ADR 0156),
        // and `test/tools-entry.test.ts` compares them. The ranked candidates
        // ride on both (#569).
        ...(resolution.addressing === 'free-text'
          ? { candidates: resolution.candidates }
          : {}),
        ...(neighbourhood === undefined ? {} : { neighbourhood }),
        result: evaluated,
      }
      const rendered = renderSlice(evaluated, compiled, budget)
      const header =
        resolution.addressing === 'free-text'
          ? `Slice for "${topic}" — ${plural(resolution.matched, 'concept')} matched` +
            (resolution.matched > resolution.seeds.length
              ? `, seeded from the top ${resolution.seeds.length}`
              : '') +
            `: ${resolution.seeds.join(', ')}\n\n`
          : ''
      return emit(
        result,
        neighbourhood === undefined
          ? `${header}${rendered}`
          : `${header}${rendered.trimEnd()}\n\n${neighbourhoodLine(neighbourhood)}\n`,
      )
    }

    const brief = renderBrief(evaluated, compiled.profileContext, budget, graph.claims)
    const sliceIds = new Set(
      evaluated.subjects
        .filter(({ type }) => type === 'concept')
        .map(({ id }) => id),
    )

    const composed = composedCatalogueOf(tool, compiled)
    if (!composed.ok) return failed(composed.diagnostics)
    const evidence = evidenceDocumentsOf(tool)
    if (!evidence.ok) return failedTool(evidence)
    const evidenceDocuments = evidence.documents
    const report = evaluateCatalogue(
      composed.composed.catalogue,
      graph,
      compiled.profileContext,
      evidenceDocuments.flatMap(({ observations }) => observations),
      composed.composed.catalogues,
      compiled.patternMemberships,
      compiled.patternVacancies,
    )
    const openQuestions: OpenQuestionRef[] = []
    for (const wave of report.waves) {
      for (const question of wave.questions) {
        if (!question.open) continue
        if (question.subjects === undefined) {
          openQuestions.push({
            wave: wave.id,
            id: question.id,
            authority: question.authority,
            question: question.question,
            materiality: question.materiality,
          })
          continue
        }
        for (const subject of question.subjects) {
          if (!sliceIds.has(subject.id)) continue
          openQuestions.push({
            wave: wave.id,
            id: question.id,
            authority: question.authority,
            question: subject.question,
            materiality: question.materiality,
            subject: subject.id,
          })
        }
      }
    }

    let reconciliation:
      | {
          readonly summary: ReconciliationReport['summary']
          readonly findings: readonly ReconciliationFinding[]
        }
      | undefined
    if (workspace.evidence.length > 0) {
      const evaluation = evaluateEvidenceWorkspace(graph, evidenceDocuments)
      if (!evaluation.ok) return failed(evaluation.diagnostics)
      const reconciled = reconcileEvidenceReports(
        workspace.id,
        evaluation.reports,
        graph,
      )
      reconciliation = {
        summary: reconciled.summary,
        findings: reconciled.findings.filter((finding) => {
          if (sliceIds.has(finding.target.id)) return true
          const asserted =
            'asserted' in finding ? finding.asserted : undefined
          return (
            asserted !== undefined &&
            (sliceIds.has(asserted.from) || sliceIds.has(asserted.to))
          )
        }),
      }
    }

    const result: AskResult = {
      format: 'yarramate/ask-result/v1',
      workspace: workspace.id,
      mode: 'advice',
      topic,
      seeds: resolution.seeds,
      matched: resolution.matched,
      slice: brief,
      ...(neighbourhood === undefined ? {} : { neighbourhood }),
      openQuestions,
      ...(reconciliation === undefined ? {} : { reconciliation }),
    }

    const lines: string[] = [
      `Advise on: ${topic} — workspace ${workspace.id}`,
      'The engine composed the ground truth below from the model; the reading and the advice are yours.',
      '',
      '== Model slice ==',
      '',
      brief.trimEnd(),
      ...(neighbourhood === undefined
        ? []
        : ['', neighbourhoodLine(neighbourhood)]),
      '',
      '== Open questions touching this slice ==',
    ]
    if (openQuestions.length === 0) {
      lines.push('  none — the catalogue is satisfied here')
    } else {
      for (const question of openQuestions) {
        lines.push(
          `  [${question.wave} · ${question.id}] ${question.question}`,
          `    why: ${question.materiality}`,
        )
      }
    }
    lines.push('', '== Evidence drift ==')
    if (reconciliation === undefined) {
      lines.push('  no evidence declared in this workspace')
    } else {
      lines.push(`  ${reconciliationLine(reconciliation.summary)}`)
      if (reconciliation.findings.length === 0) {
        lines.push('  no findings touch this slice')
      } else {
        for (const finding of reconciliation.findings) {
          lines.push(
            `  ${finding.target.id}: ${finding.result} (${finding.provider})`,
          )
        }
      }
    }
    return emit(result, `${lines.join('\n')}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}
