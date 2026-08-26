import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import { renderBrief } from './brief.js'
import { deriveChangedSubjects } from './changed.js'
import {
  humanDiagnostics,
  packageVersion,
  usage,
  type CliResult,
} from './cli-support.js'
import {
  compileWorkspaceWithProfileContext,
  type Diagnostic,
  type GraphClaim,
} from './compiler.js'
import { serializeSemanticGraph } from './graph.js'
import {
  evaluateEvidenceWorkspace,
  loadEvidence,
  type EvidenceDocument,
} from './evidence.js'
import {
  evaluateProjection,
  loadProjection,
  renderProjectionMarkdown,
  type ProjectionResult,
} from './projection.js'
import { buildRtm, renderRtmMarkdown } from './rtm.js'
import { workbookFrom } from './workbook.js'
import { loadWorkspaceManifest } from './workspace.js'

// The adapter stays a separate process behind the verb: the core never
// imports adapter code (the adapter-runtime-dependency exclusion), it
// hands the invocation to the sibling binary shipped in the same package.
const here = dirname(fileURLToPath(import.meta.url))
const likec4AdapterEntry = join(here, 'adapters', 'likec4-cli.js')

const claimValue = (
  claims: readonly GraphClaim[],
  subject: string,
  predicate: string,
): string | undefined => {
  const object = claims.find(
    (claim) => claim.subject === subject && claim.predicate === predicate,
  )?.object
  return object !== undefined && 'value' in object ? object.value : undefined
}

const briefFileName = (id: string): string =>
  `${id.replaceAll('#', '--')}.md`

interface ParsedExport {
  readonly positionals: readonly string[]
  readonly out?: string
  readonly budget?: number
  readonly changed?: string
  readonly json: boolean
}

const parseExportOptions = (
  options: readonly string[],
): ParsedExport | undefined => {
  const positionals: string[] = []
  let out: string | undefined
  let budget: number | undefined
  let changed: string | undefined
  let json = false
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index]
    if (option === '--json') {
      json = true
      continue
    }
    if (
      option === '--out' ||
      option === '--budget' ||
      option === '--changed'
    ) {
      const value = options[index + 1]
      if (value === undefined || value.startsWith('-')) return undefined
      if (option === '--out') {
        if (out !== undefined) return undefined
        out = value
      } else if (option === '--changed') {
        if (changed !== undefined) return undefined
        changed = value
      } else {
        if (budget !== undefined || !/^[1-9][0-9]*$/.test(value)) {
          return undefined
        }
        budget = Number(value)
      }
      index += 1
      continue
    }
    if (option === undefined || option.startsWith('-')) return undefined
    positionals.push(option)
  }
  return {
    positionals,
    ...(out === undefined ? {} : { out }),
    ...(budget === undefined ? {} : { budget }),
    ...(changed === undefined ? {} : { changed }),
    json,
  }
}

export function runExportCommand(
  options: readonly string[],
  cwd: string,
): CliResult {
  const [kind, ...rest] = options
  if (
    kind === undefined ||
    !['graph', 'markdown', 'briefs', 'rtm', 'likec4', 'xlsx'].includes(kind)
  ) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }
  const parsed = parseExportOptions(rest)
  if (parsed === undefined) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }

  // likec4 delegates whole: <likec4-project.yaml> <output-dir> <workspace>.
  if (kind === 'likec4') {
    const [projectDefinition, outputDirectory, workspacePath] =
      parsed.positionals
    if (
      parsed.positionals.length !== 3 ||
      projectDefinition === undefined ||
      outputDirectory === undefined ||
      workspacePath === undefined ||
      parsed.out !== undefined ||
      parsed.budget !== undefined ||
      parsed.json
    ) {
      return { exitCode: 2, stdout: '', stderr: usage }
    }
    const changedArguments =
      parsed.changed === undefined ? [] : ['--changed', parsed.changed]
    if (!existsSync(likec4AdapterEntry)) {
      return {
        exitCode: 2,
        stdout: '',
        stderr:
          `LikeC4 adapter entry not found at ${likec4AdapterEntry}; ` +
          'run from the installed package or use the yarramate-likec4 binary directly\n',
      }
    }
    const delegated = spawnSync(
      process.execPath,
      [
        likec4AdapterEntry,
        'export-project',
        projectDefinition,
        outputDirectory,
        workspacePath,
        ...changedArguments,
      ],
      { cwd, encoding: 'utf8' },
    )
    const exitCode = delegated.status === 0 ? 0 : delegated.status === 1 ? 1 : 2
    return {
      exitCode,
      stdout: delegated.stdout ?? '',
      stderr: delegated.stderr ?? '',
    }
  }

  const usesChanged = parsed.changed !== undefined
  const expectedPositionals =
    kind === 'graph' || kind === 'rtm' || usesChanged ? 1 : 2
  const workspacePath = parsed.positionals[expectedPositionals - 1]
  const projectionPath =
    kind === 'graph' || kind === 'rtm' || usesChanged
      ? undefined
      : parsed.positionals[0]
  if (
    parsed.positionals.length !== expectedPositionals ||
    workspacePath === undefined ||
    parsed.json ||
    (usesChanged && (kind === 'graph' || kind === 'rtm')) ||
    (parsed.budget !== undefined && kind !== 'briefs') ||
    ((kind === 'briefs' || kind === 'rtm' || kind === 'xlsx') &&
      parsed.out === undefined)
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
          'export requires an explicit workspace manifest (yarramate/workspace/v1)\n',
      }
    }
    const failed = (diagnostics: readonly Diagnostic[]): CliResult => ({
      exitCode: 1,
      stdout: humanDiagnostics(diagnostics),
      stderr: '',
    })
    const loadedWorkspace = loadWorkspaceManifest(
      { path: workspacePath, source: manifestSource },
      cwd,
    )
    if (!loadedWorkspace.ok) return failed(loadedWorkspace.diagnostics)
    const workspace = loadedWorkspace.workspace

    // Named rather than inlined so the workbook can pin its digests against
    // exactly the bytes that compiled, the way a visual commit does (#355).
    const sources = [
      ...workspace.profiles,
      ...workspace.patterns,
      ...workspace.documents,
    ].map((path) => ({
      path,
      source: readFileSync(resolve(cwd, path), 'utf8'),
    }))
    const compilation = compileWorkspaceWithProfileContext(sources)
    if (!compilation.ok) return failed(compilation.diagnostics)

    if (kind === 'rtm') {
      // The RTM is a compliance bundle over the whole workspace: the
      // evidence overlay supplies the verdict column, so it loads here
      // exactly as reconcile loads it (ADR 0071).
      const evidenceDocuments: EvidenceDocument[] = []
      for (const path of workspace.evidence) {
        const loaded = loadEvidence({
          path,
          source: readFileSync(resolve(cwd, path), 'utf8'),
        })
        if (!loaded.ok) return failed(loaded.diagnostics)
        evidenceDocuments.push(loaded.evidence)
      }
      const evaluation = evaluateEvidenceWorkspace(
        compilation.graph,
        evidenceDocuments,
      )
      if (!evaluation.ok) return failed(evaluation.diagnostics)
      const rtm = buildRtm(
        workspace.id,
        compilation.graph,
        compilation.profileContext,
        evaluation.reports,
      )
      const outDirectory = resolve(cwd, parsed.out!)
      mkdirSync(outDirectory, { recursive: true })
      writeFileSync(
        join(outDirectory, 'RTM.md'),
        renderRtmMarkdown(rtm),
        'utf8',
      )
      writeFileSync(
        join(outDirectory, 'rtm.json'),
        `${JSON.stringify(rtm, null, 2)}\n`,
        'utf8',
      )
      return {
        exitCode: 0,
        stdout:
          `Wrote RTM.md and rtm.json (${rtm.summary.rows} row${
            rtm.summary.rows === 1 ? '' : 's'
          }, ${rtm.summary.gaps} gap${
            rtm.summary.gaps === 1 ? '' : 's'
          }) to ${parsed.out}\n`,
        stderr: '',
      }
    }

    if (kind === 'graph') {
      const serialized = serializeSemanticGraph(compilation.graph)
      if (parsed.out === undefined) {
        return { exitCode: 0, stdout: serialized, stderr: '' }
      }
      const outPath = resolve(cwd, parsed.out)
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, serialized, 'utf8')
      return {
        exitCode: 0,
        stdout: `Wrote graph to ${parsed.out}\n`,
        stderr: '',
      }
    }

    let result: ProjectionResult
    if (parsed.changed !== undefined) {
      // Review slices derive from git (ADR 0065): changed subjects seed
      // the connected neighbourhood the reviewer inspects.
      const documentIdByPath = new Map(
        compilation.graph.documents.map(({ id, source }) => [source, id]),
      )
      const derived = deriveChangedSubjects(
        cwd,
        parsed.changed,
        workspace.documents.map((path) => ({
          path,
          source: readFileSync(resolve(cwd, path), 'utf8'),
          documentId: documentIdByPath.get(path) ?? path,
        })),
      )
      if (!derived.ok) {
        return { exitCode: 2, stdout: '', stderr: `${derived.message}\n` }
      }
      const endpoints = new Set<string>()
      for (const relationshipId of derived.changed.relationships) {
        const claim = compilation.graph.claims.find(
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
      result = evaluateProjection(
        compilation.graph,
        {
          format: 'yarramate/projection/v1',
          id: 'review-slice',
          version: '0.0',
          query: { subjects: seeds, relationships: 'connected' },
          presentation: {
            title: `Review slice ${parsed.changed}`,
            description:
              `Connected neighbourhood of the subjects changed in ` +
              `${parsed.changed}.`,
          },
        },
        compilation.profileContext,
      )
    } else {
      const loadedProjection = loadProjection({
        path: projectionPath!,
        source: readFileSync(resolve(cwd, projectionPath!), 'utf8'),
      })
      if (!loadedProjection.ok) return failed(loadedProjection.diagnostics)
      result = evaluateProjection(
        compilation.graph,
        loadedProjection.projection,
        compilation.profileContext,
      )
    }

    if (kind === 'xlsx') {
      // A workbook an architect can work in (#355). It takes a PROJECTION,
      // like markdown and briefs do, which is what gives it version selection
      // for free: a projection query already has a `states` facet, so
      // "export the target state" is an existing capability rather than a
      // flag competing with it.
      const bytes = workbookFrom(result, {
        workspace: workspace.id,
        yarramateVersion: packageVersion,
        sourceDigests: Object.fromEntries(
          sources.map(({ path, source }) => [
            path,
            createHash('sha256').update(source, 'utf8').digest('hex'),
          ]),
        ),
        conceptKinds: [
          ...compilation.profileContext.conceptKindLineages.keys(),
        ].sort(),
        relationshipKinds: [
          ...compilation.profileContext.relationshipKindLineages.keys(),
        ].sort(),
        statuses: ['planned', 'current', 'retired'],
      })
      const outPath = resolve(cwd, parsed.out!)
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, bytes)
      return {
        exitCode: 0,
        stdout: `Wrote workbook to ${parsed.out}\n`,
        stderr: '',
      }
    }

    if (kind === 'markdown') {
      const rendered = renderProjectionMarkdown(
        result,
        compilation.profileContext,
      )
      if (parsed.out === undefined) {
        return { exitCode: 0, stdout: rendered, stderr: '' }
      }
      const outPath = resolve(cwd, parsed.out)
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, rendered, 'utf8')
      return {
        exitCode: 0,
        stdout: `Wrote markdown to ${parsed.out}\n`,
        stderr: '',
      }
    }

    // briefs: the handoff bundle — one brief per projected concept, each
    // the concept's one-hop neighbourhood (ADR 0055), plus an index so N
    // implementers can each pick up one slice.
    const stateIds = new Set(
      result.claims
        .filter(({ predicate }) => predicate === 'yarramate/state/type')
        .map(({ subject }) => subject),
    )
    const concepts = result.subjects
      .filter(({ id, type }) => type === 'concept' && !stateIds.has(id))
      .map(({ id }) => id)
      .sort((left, right) => left.localeCompare(right))
    const outDirectory = resolve(cwd, parsed.out!)
    mkdirSync(outDirectory, { recursive: true })
    const indexLines: string[] = [
      `# Briefs — ${result.presentation?.title ?? result.projection}`,
      '',
      `Derived from projection ${result.projection}; one brief per concept,`,
      'each the concept\'s connected neighbourhood as declared today.',
      '',
    ]
    for (const id of concepts) {
      const slice: ProjectionResult = evaluateProjection(
        compilation.graph,
        {
          format: 'yarramate/projection/v1',
          id: 'export-brief',
          version: '0.0',
          query: { subjects: [id], relationships: 'connected' },
          presentation: {
            title:
              claimValue(result.claims, id, 'yarramate/concept/name') ?? id,
            description: `The neighbourhood of ${id} as declared today.`,
          },
        },
        compilation.profileContext,
      )
      const brief = renderBrief(
        slice,
        compilation.profileContext,
        parsed.budget,
        compilation.graph.claims,
      )
      writeFileSync(join(outDirectory, briefFileName(id)), brief, 'utf8')
      const name = claimValue(result.claims, id, 'yarramate/concept/name')
      const conceptKind =
        claimValue(result.claims, id, 'yarramate/concept/kind') ?? 'unknown'
      const status = claimValue(
        result.claims,
        id,
        'yarramate/lifecycle/status',
      )
      indexLines.push(
        `- [${name ?? id}](${briefFileName(id)}) — ` +
          `${conceptKind.split('#')[1] ?? conceptKind}` +
          `${status === undefined ? '' : ` (${status})`} — \`${id}\``,
      )
    }
    if (concepts.length === 0) {
      indexLines.push('No concepts selected by this projection.')
    }
    writeFileSync(
      join(outDirectory, 'INDEX.md'),
      `${indexLines.join('\n')}\n`,
      'utf8',
    )
    return {
      exitCode: 0,
      stdout: `Wrote ${concepts.length} brief${concepts.length === 1 ? '' : 's'} and INDEX.md to ${parsed.out}\n`,
      stderr: '',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}
