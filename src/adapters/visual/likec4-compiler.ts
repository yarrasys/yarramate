import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'
import type {
  VisualAuthority,
  VisualCompilerCommand,
  VisualDiagnostic,
  VisualModel,
} from './protocol.js'
import {
  promoteCompiledModel,
  type VisualSessionPaths,
} from './session-store.js'

/**
 * Document name reported by diagnostics that no staged source file owns — a
 * compiler that could not be executed, ran past its budget, or answered with
 * something other than the report its command promised.
 */
export const VISUAL_COMPILER_DOCUMENT = 'likec4-compiler'

/**
 * Name of the exported document inside the candidate root. The leading dot
 * cannot collide with a staged model file, because model paths reject
 * dot-prefixed segments.
 */
export const VISUAL_COMPILER_EXPORT_FILE = '.likec4-export.json'

export const VISUAL_COMPILER_LIMITS = {
  timeoutMs: 30_000,
  outputBytes: 1024 * 1024,
  exportBytes: 16 * 1024 * 1024,
  /** Grace between the abort's SIGTERM and an unconditional SIGKILL. */
  killGraceMs: 2_000,
} as const

const MODEL_SOURCE_EXTENSIONS = ['.c4', '.likec4'] as const

export interface CompileVisualModelOptions {
  readonly model: VisualModel
  /** Trusted preflight vector. Never assembled from browser input. */
  readonly command: VisualCompilerCommand
  readonly paths: VisualSessionPaths
  readonly now?: () => Date
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  readonly maxOutputBytes?: number
  readonly maxExportBytes?: number
}

export interface CompiledVisualModel {
  readonly candidate: string
  readonly candidateDir: string
  readonly authority: VisualAuthority
  readonly initialView: string
  readonly views: readonly string[]
  readonly exportPath: string
}

export type LikeC4CompilationResult =
  | {
      readonly ok: true
      readonly compiled: CompiledVisualModel
      readonly diagnostics: readonly VisualDiagnostic[]
    }
  | {
      readonly ok: false
      readonly diagnostics: readonly VisualDiagnostic[]
    }

interface CompilerBudget {
  readonly timeoutMs: number
  readonly outputBytes: number
  readonly exportBytes: number
  readonly signal: AbortSignal | undefined
}

type CompilerStage = 'validate' | 'export'

type ProcessStatus = 'exited' | 'timeout' | 'cancelled' | 'overflow' | 'failed'

interface ProcessOutcome {
  readonly status: ProcessStatus
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  /** Spawn or abort error message; empty when the child ran. */
  readonly failure: string
}

/**
 * Reads a trusted compiler document's own fields. Anything that is not a plain
 * object simply has no fields, so the caller's field checks report the fault.
 */
const isPlainObject = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const plainFields = (value: unknown): Readonly<Record<string, unknown>> =>
  isPlainObject(value) ? value : {}

const pointerSegment = (segment: string) =>
  segment.replace(/~/g, '~0').replace(/\//g, '~1')

const compilerDiagnostic = (
  code: string,
  message: string,
  path: string = VISUAL_COMPILER_DOCUMENT,
  pointer = '/files',
  line = 1,
  column = 1,
): VisualDiagnostic => ({
  severity: 'error',
  code,
  message,
  path,
  pointer,
  line,
  column,
})

/** Keeps a compiler's own prose from entering the diagnostic stream unbounded. */
const summarise = (text: string) => {
  const line = text
    .split('\n')
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0)
  if (line === undefined) return 'no diagnostic output'
  return line.length > 500 ? `${line.slice(0, 500)}…` : line
}

const runCompiler = (
  command: VisualCompilerCommand,
  args: readonly string[],
  cwd: string,
  budget: CompilerBudget,
): Promise<ProcessOutcome> =>
  new Promise((settle) => {
    // An abort that already landed raises no further event, so a signal
    // cancelled before this call — including in the window between one stage
    // settling and the next registering its listener — must be read directly.
    if (budget.signal?.aborted === true) {
      settle({ status: 'cancelled', code: null, failure: '', stdout: '', stderr: '' })
      return
    }

    const controller = new AbortController()
    let timedOut = false
    const deadline = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, budget.timeoutMs)
    const cancel = () => controller.abort()
    budget.signal?.addEventListener('abort', cancel, { once: true })

    const child = spawn(command.command, [...args], {
      shell: false,
      signal: controller.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
    })

    // Aborting the spawn only sends SIGTERM; a child that declines to honour it
    // must still not outlive its budget.
    let grace: NodeJS.Timeout | undefined
    controller.signal.addEventListener(
      'abort',
      () => {
        grace = setTimeout(
          () => child.kill('SIGKILL'),
          VISUAL_COMPILER_LIMITS.killGraceMs,
        )
        grace.unref()
      },
      { once: true },
    )

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let bytes = 0
    let overflowed = false
    const bound = (stream: Readable | null, sink: Buffer[]) => {
      stream?.on('data', (chunk: Buffer) => {
        bytes += chunk.byteLength
        if (bytes > budget.outputBytes) {
          overflowed = true
          child.kill('SIGKILL')
          return
        }
        sink.push(chunk)
      })
    }
    bound(child.stdout, stdout)
    bound(child.stderr, stderr)

    let failure = ''
    let settled = false
    const finish = (status: ProcessStatus, code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      if (grace !== undefined) clearTimeout(grace)
      budget.signal?.removeEventListener('abort', cancel)
      settle({
        status,
        code,
        failure,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    }

    child.on('error', (error: Error) => {
      failure = error.message
      // A child that never started owns no stdio to close, so a spawn failure
      // settles here rather than waiting for a 'close' that may not arrive.
      if (child.pid === undefined) finish('failed', null)
    })
    child.on('close', (code) => {
      if (overflowed) finish('overflow', code)
      else if (timedOut) finish('timeout', code)
      else if (controller.signal.aborted) finish('cancelled', code)
      else if (failure !== '') finish('failed', code)
      else finish('exited', code)
    })
  })

const processDiagnostics = (
  stage: CompilerStage,
  outcome: ProcessOutcome,
  budget: CompilerBudget,
): readonly VisualDiagnostic[] => {
  switch (outcome.status) {
    case 'timeout':
      return [
        compilerDiagnostic(
          'YMVS204',
          `LikeC4 ${stage} exceeded its ${budget.timeoutMs}ms budget`,
        ),
      ]
    case 'cancelled':
      return [
        compilerDiagnostic(
          'YMVS204',
          `LikeC4 ${stage} was cancelled before it finished`,
        ),
      ]
    case 'overflow':
      return [
        compilerDiagnostic(
          'YMVS205',
          `LikeC4 ${stage} exceeded its ${budget.outputBytes} byte output budget`,
        ),
      ]
    case 'failed':
      return [
        compilerDiagnostic(
          'YMVS203',
          `LikeC4 ${stage} could not be executed: ${summarise(outcome.failure)}`,
        ),
      ]
    default:
      return []
  }
}

const exitDiagnostic = (stage: CompilerStage, outcome: ProcessOutcome) =>
  compilerDiagnostic(
    'YMVS203',
    `LikeC4 ${stage} exited with status ${outcome.code}: ${summarise(
      outcome.stderr,
    )}`,
  )

/**
 * Project the staged configuration declares, if it declares one.
 */
const declaredProject = (model: VisualModel): string | undefined => {
  const config = model.files['likec4.config.json']
  if (config === undefined) return undefined
  try {
    const name = plainFields(JSON.parse(config)).name
    return typeof name === 'string' && name.length > 0 ? name : undefined
  } catch {
    // An unreadable configuration is the CLI's to report, not this adapter's.
    return undefined
  }
}

/**
 * The one exported project this rendering comes from.
 *
 * `likec4 export json` writes a bare project document for exactly one project
 * and a bare array otherwise, and a workspace that stages a configuration
 * resolves the named project beside an implicit default over the same sources.
 * The named project is asked for on the command line; this is the reader that
 * still resolves whatever arrives: one project, else the only project defining
 * the requested view, else the one the configuration named. Anything still
 * ambiguous is refused rather than picked from.
 */
const projectDocument = (
  exported: unknown,
  initialView: string,
  declared: string | undefined,
):
  | { readonly ok: true; readonly document: unknown }
  | {
      readonly ok: false
      readonly projects: number
      readonly matches: number
    } => {
  const documents = Array.isArray(exported) ? exported : [exported]
  const projects = documents.filter((document) =>
    isPlainObject(plainFields(document).views),
  )
  const only = projects[0]
  if (projects.length === 1 && only !== undefined) {
    return { ok: true, document: only }
  }
  const defining = projects.filter(
    (document) => initialView in plainFields(plainFields(document).views),
  )
  const named =
    declared === undefined
      ? []
      : defining.filter(
          (document) => plainFields(document).projectId === declared,
        )
  const resolved = named.length === 1 ? named : defining
  const match = resolved[0]
  return resolved.length === 1 && match !== undefined
    ? { ok: true, document: match }
    : { ok: false, projects: projects.length, matches: defining.length }
}

/**
 * Candidate-relative POSIX path for a source location the compiler reported,
 * or `undefined` when the location is not a file staged under this candidate.
 */
const stagedSource = (raw: unknown, candidateDir: string) => {
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  const within = relative(candidateDir, resolve(candidateDir, raw))
  if (within === '' || within.startsWith('..') || isAbsolute(within)) {
    return undefined
  }
  return within.split(sep).join('/')
}

const reportedLocation = (entry: Readonly<Record<string, unknown>>) => {
  // LikeC4 reports LSP ranges, which count lines and characters from zero.
  const start = plainFields(plainFields(entry.range).start)
  const oneBased = (value: unknown) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0
      ? value + 1
      : 1
  return { line: oneBased(start.line), column: oneBased(start.character) }
}

const validationDiagnostics = (
  entries: readonly unknown[],
  candidateDir: string,
): readonly VisualDiagnostic[] =>
  entries.flatMap((entry) => {
    const fields = plainFields(entry)
    // LikeC4 reports warnings and hints beside errors and still exits clean;
    // only an error may block a candidate.
    const severity = fields.severity
    if (severity !== undefined && severity !== 1 && severity !== 'error') {
      return []
    }
    const message =
      typeof fields.message === 'string' && fields.message.length > 0
        ? fields.message
        : 'LikeC4 reported an unlabelled validation error'
    const source = stagedSource(fields.sourceFsPath, candidateDir)
    if (source === undefined) return [compilerDiagnostic('YMVS201', message)]
    const { line, column } = reportedLocation(fields)
    return [
      compilerDiagnostic(
        'YMVS201',
        message,
        source,
        `/files/${pointerSegment(source)}`,
        line,
        column,
      ),
    ]
  })

const validate = async (
  command: VisualCompilerCommand,
  model: VisualModel,
  candidateDir: string,
  budget: CompilerBudget,
): Promise<readonly VisualDiagnostic[]> => {
  const sources = Object.keys(model.files)
    .filter((file) =>
      MODEL_SOURCE_EXTENSIONS.some((allowed) => allowed === extname(file)),
    )
    .sort()
  const outcome = await runCompiler(
    command,
    [
      ...command.args,
      'validate',
      '--json',
      '--no-layout',
      ...sources.flatMap((file) => ['--file', file]),
      candidateDir,
    ],
    candidateDir,
    budget,
  )
  const bounded = processDiagnostics('validate', outcome, budget)
  if (bounded.length > 0) return bounded

  // No report at all is a process failure; a report that is not the promised
  // JSON is a broken compiler contract.
  if (outcome.stdout.trim() === '') {
    return outcome.code === 0 ? [] : [exitDiagnostic('validate', outcome)]
  }
  let report: unknown
  try {
    report = JSON.parse(outcome.stdout)
  } catch {
    return [
      compilerDiagnostic(
        'YMVS206',
        `LikeC4 validate did not emit a JSON report: ${summarise(outcome.stdout)}`,
      ),
    ]
  }
  const entries = plainFields(report).diagnostics
  if (entries !== undefined && !Array.isArray(entries)) {
    return [
      compilerDiagnostic(
        'YMVS206',
        'LikeC4 validate reported diagnostics that are not a list',
      ),
    ]
  }
  const reported = validationDiagnostics(entries ?? [], candidateDir)
  if (reported.length > 0) return reported
  // A compiler that fails without naming a cause must still fail the candidate.
  return outcome.code === 0 ? [] : [exitDiagnostic('validate', outcome)]
}

const exportViews = async (
  command: VisualCompilerCommand,
  model: VisualModel,
  candidateDir: string,
  exportPath: string,
  budget: CompilerBudget,
): Promise<{
  readonly views?: readonly string[]
  readonly diagnostics: readonly VisualDiagnostic[]
}> => {
  const declared = declaredProject(model)
  const outcome = await runCompiler(
    command,
    [
      ...command.args,
      'export',
      'json',
      '--pretty',
      // Without a project the CLI writes every project it resolved, and a
      // staged configuration always resolves at least two.
      ...(declared === undefined ? [] : ['--project', declared]),
      '-o',
      exportPath,
      candidateDir,
    ],
    candidateDir,
    budget,
  )
  const bounded = processDiagnostics('export', outcome, budget)
  if (bounded.length > 0) return { diagnostics: bounded }
  if (outcome.code !== 0) {
    return { diagnostics: [exitDiagnostic('export', outcome)] }
  }

  let raw: Buffer
  try {
    raw = await readFile(exportPath)
  } catch {
    return {
      diagnostics: [
        compilerDiagnostic(
          'YMVS207',
          `LikeC4 export did not write "${VISUAL_COMPILER_EXPORT_FILE}"`,
        ),
      ],
    }
  }
  if (raw.byteLength > budget.exportBytes) {
    return {
      diagnostics: [
        compilerDiagnostic(
          'YMVS205',
          `LikeC4 export exceeded its ${budget.exportBytes} byte output budget`,
        ),
      ],
    }
  }
  let exported: unknown
  try {
    exported = JSON.parse(raw.toString('utf8'))
  } catch {
    return {
      diagnostics: [
        compilerDiagnostic('YMVS207', 'LikeC4 export document is not JSON'),
      ],
    }
  }
  const sole = projectDocument(exported, model.initialView, declared)
  if (!sole.ok) {
    return {
      diagnostics: [
        compilerDiagnostic(
          sole.projects === 0 ? 'YMVS207' : 'YMVS210',
          sole.projects === 0
            ? 'LikeC4 export document does not carry a view collection'
            : `LikeC4 export carries ${sole.projects} projects and ${sole.matches} of them define "${model.initialView}", so no single rendering can be promoted`,
        ),
      ],
    }
  }
  // The promoted artefact is always one project document, because that is what
  // the browser's model factory reads.
  if (sole.document !== exported) {
    await writeFile(exportPath, JSON.stringify(sole.document, null, 2), {
      mode: 0o600,
    })
  }
  const views = plainFields(sole.document).views
  if (!isPlainObject(views)) {
    return {
      diagnostics: [
        compilerDiagnostic(
          'YMVS207',
          'LikeC4 export document does not carry a view collection',
        ),
      ],
    }
  }
  const ids = Object.keys(views).sort()
  if (ids.length === 0) {
    return {
      diagnostics: [
        compilerDiagnostic('YMVS208', 'LikeC4 export contains no views'),
      ],
    }
  }
  if (!ids.includes(model.initialView)) {
    return {
      diagnostics: [
        compilerDiagnostic(
          'YMVS209',
          `LikeC4 export does not contain the requested initial view "${model.initialView}"`,
        ),
      ],
    }
  }
  return { views: ids, diagnostics: [] }
}

/**
 * Validates and exports one candidate model with the trusted LikeC4 command,
 * promoting it only once a complete export naming the requested initial view
 * has been parsed. Every process, parse, and diagnostic failure becomes a
 * `VisualDiagnostic` and leaves the last good rendering in place.
 */
export const compileVisualModel = async (
  options: CompileVisualModelOptions,
): Promise<LikeC4CompilationResult> => {
  const { command, model, paths } = options
  // The command vector is trusted preflight input, so a relative executable is
  // a caller defect: resolving it against PATH or the cwd is exactly the
  // ambiguity a session must not carry into a spawned process.
  if (!isAbsolute(command.command)) {
    return {
      ok: false,
      diagnostics: [
        compilerDiagnostic(
          'YMVS202',
          `LikeC4 compiler command "${command.command}" must be an absolute executable path`,
        ),
      ],
    }
  }
  // Staging a candidate for a request the caller already withdrew would leave
  // a directory behind for work that can never be promoted.
  if (options.signal?.aborted === true) {
    return {
      ok: false,
      diagnostics: [
        compilerDiagnostic(
          'YMVS204',
          'LikeC4 compilation was cancelled before it started',
        ),
      ],
    }
  }
  const budget: CompilerBudget = {
    timeoutMs: options.timeoutMs ?? VISUAL_COMPILER_LIMITS.timeoutMs,
    outputBytes: options.maxOutputBytes ?? VISUAL_COMPILER_LIMITS.outputBytes,
    exportBytes: options.maxExportBytes ?? VISUAL_COMPILER_LIMITS.exportBytes,
    signal: options.signal,
  }

  let views: readonly string[] | undefined
  let exportPath = ''
  const promotion = await promoteCompiledModel(paths, {
    model,
    now: options.now ?? (() => new Date()),
    compile: async (candidateDir) => {
      const invalid = await validate(command, model, candidateDir, budget)
      if (invalid.length > 0) return invalid
      exportPath = join(candidateDir, VISUAL_COMPILER_EXPORT_FILE)
      const exported = await exportViews(
        command,
        model,
        candidateDir,
        exportPath,
        budget,
      )
      views = exported.views
      return exported.diagnostics
    },
  })

  if (!promotion.promoted || views === undefined) {
    return { ok: false, diagnostics: promotion.diagnostics }
  }
  return {
    ok: true,
    diagnostics: [],
    compiled: {
      candidate: promotion.candidate,
      candidateDir: promotion.candidateDir,
      authority: model.authority,
      initialView: model.initialView,
      views,
      exportPath,
    },
  }
}
