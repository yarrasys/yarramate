import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  truncate,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import {
  VISUAL_LIMITS,
  parseVisualEvent,
  parseVisualHandoff,
  parseVisualModel,
  parseVisualResponse,
  parseVisualSessionDescriptor,
  parseVisualSessionRequest,
  type VisualAuthority,
  type VisualDiagnostic,
  type VisualEvent,
  type VisualFreezeReason,
  type VisualHandoff,
  type VisualHandoffDecision,
  type VisualHandoffSummary,
  type VisualModel,
  type VisualResponse,
  type VisualSessionDescriptor,
  type VisualSessionRequest,
  type VisualTerminationReason,
} from './protocol.js'

export const VISUAL_SESSION_MARKER_FORMAT =
  'yarramate/visual-session-marker/v1' as const

export const VISUAL_ACTIVE_MODEL_FORMAT =
  'yarramate/visual-active-model/v1' as const

/**
 * Upper bound on how many orphaned sessions one `start` prunes. Cleanup runs on
 * the critical path of a new session, so a directory full of orphans must cost
 * a bounded amount of work; the remainder is collected by the next start.
 */
export const VISUAL_SESSION_PRUNE_LIMIT = 64

const CANDIDATE_NAME = /^[0-9]{6}$/
const IDENTIFIER = /^[0-9a-f]{32}$/
const TIMESTAMP =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/
const NEWLINE = 0x0a

const ACTIONABLE_EVENT_TYPES: Readonly<Record<string, true>> = {
  'chat.message': true,
  'choice.selected': true,
  'session.end': true,
}

/**
 * Whether a journaled event requires an agent turn. Navigation is journaled for
 * context but only interrupts the agent when the browser marked it as needing
 * attention. The runtime shares this definition rather than restating it, so
 * the queue the server bounds and the events recovery replays cannot diverge.
 */
export const isActionableVisualEvent = (event: VisualEvent): boolean =>
  ACTIONABLE_EVENT_TYPES[event.type] === true ||
  (event.type === 'view.navigate' && event.payload.requiresAttention)

export interface VisualSessionPaths {
  readonly root: string
  readonly marker: string
  readonly descriptor: string
  readonly journal: string
  readonly candidates: string
  readonly activeModel: string
}

export interface SessionDependencies {
  readonly baseDir: string
  readonly now: () => Date
  readonly randomBytes: (size: number) => Buffer
}

/**
 * The only session state that outlives the runtime process. Recovery never
 * resumes the server or the compiler, so the marker carries the session
 * identity, its age for pruning, and the authority label the handoff must
 * report — and deliberately not the candidate model or the compiler vector.
 */
export interface VisualSessionMarker {
  readonly format: typeof VISUAL_SESSION_MARKER_FORMAT
  readonly id: string
  readonly createdAt: string
  readonly authority: VisualAuthority
}

/**
 * Last-good rendering pointer. It names a staged candidate directory instead of
 * embedding the model so the swap is a single rename of a small file.
 */
export interface VisualActiveModel {
  readonly format: typeof VISUAL_ACTIVE_MODEL_FORMAT
  readonly candidate: string
  readonly authority: VisualAuthority
  readonly initialView: string
  readonly promotedAt: string
}

export interface VisualSessionCreated {
  readonly paths: VisualSessionPaths
  readonly browserToken: string
  readonly agentToken: string
}

export interface VisualAppendAccepted {
  readonly ok: true
  readonly lastSequence: number
  readonly transcriptBytes: number
  readonly duplicate: boolean
}

export interface VisualAppendRejected {
  readonly ok: false
  readonly freeze?: VisualFreezeReason
  readonly diagnostics: readonly VisualDiagnostic[]
}

export type VisualAppendResult = VisualAppendAccepted | VisualAppendRejected

export interface ModelPromotion {
  readonly model: VisualModel
  readonly now: () => Date
  readonly compile: (
    candidateDir: string,
  ) => Promise<readonly VisualDiagnostic[]>
}

export interface ModelPromotionResult {
  readonly promoted: boolean
  readonly candidate: string
  readonly candidateDir: string
  readonly diagnostics: readonly VisualDiagnostic[]
}

/** In-process append state, rebuilt from disk whenever the journal size drifts. */
interface JournalState {
  bytes: number
  lastSequence: number
  readonly eventIds: Set<string>
  readonly responseIds: Set<string>
  readonly sessionId: string
}

interface JournalRead {
  readonly records: readonly (VisualEvent | VisualResponse)[]
  readonly lastSequence: number
  /** Bytes up to and including the last newline; a longer file has a torn tail. */
  readonly completeBytes: number
  readonly size: number
}

const states = new Map<string, JournalState>()
const queues = new Map<string, Promise<unknown>>()

const storeError = (code: string, message: string) =>
  new Error(`${code}: ${message}`)

const storeDiagnostic = (
  code: string,
  message: string,
  path: string,
  pointer: string,
  line = 1,
): VisualDiagnostic => ({
  severity: 'error',
  code,
  message,
  path,
  pointer,
  line,
  column: 1,
})

/**
 * Reads a persisted runtime document's own fields. Anything that is not a plain
 * object simply has no fields, so the caller's field checks report the fault.
 */
const documentFields = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {}

/**
 * Every mutation of one session runs in call order. Rejections are absorbed
 * from the stored chain so a rejected append cannot poison later writes.
 */
const serialize = <T>(key: string, action: () => Promise<T>): Promise<T> => {
  const pending = (queues.get(key) ?? Promise.resolve()).then(action)
  queues.set(
    key,
    pending.then(
      () => undefined,
      () => undefined,
    ),
  )
  return pending
}

const forget = (paths: VisualSessionPaths) => {
  states.delete(paths.journal)
  queues.delete(paths.journal)
  queues.delete(paths.candidates)
}

const drawHex = (
  randomBytes: SessionDependencies['randomBytes'],
  size: number,
) => {
  const drawn = randomBytes(size)
  if (drawn.byteLength < size) {
    throw storeError(
      'YMVS129',
      `Random source returned ${drawn.byteLength} bytes for a ${size}-byte draw`,
    )
  }
  return drawn.subarray(0, size).toString('hex')
}

/**
 * A rename is only durable once the containing directory is flushed. Not every
 * platform and filesystem allows fsync on a directory descriptor, and failing
 * to harden an already completed write must never fail a session operation.
 */
const syncDirectory = async (directory: string) => {
  try {
    const handle = await open(directory, constants.O_RDONLY)
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch {
    return
  }
}

const writePrivateFile = async (path: string, contents: string) => {
  const handle = await open(path, 'w', 0o600)
  try {
    // 'w' does not narrow an existing file's mode, and a temporary left behind
    // by a crash must not keep whatever mode it had.
    await handle.chmod(0o600)
    await handle.writeFile(contents, { encoding: 'utf8' })
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Write-then-rename, so a reader never observes a half-written document. */
const writePrivateJson = async (path: string, value: unknown) => {
  const temporary = `${path}.tmp`
  await writePrivateFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temporary, path)
  await syncDirectory(dirname(path))
}

export const visualSessionPaths = (root: string): VisualSessionPaths => {
  const base = resolve(root)
  return {
    root: base,
    marker: join(base, 'session.json'),
    descriptor: join(base, 'descriptor.json'),
    journal: join(base, 'journal.jsonl'),
    candidates: join(base, 'candidates'),
    activeModel: join(base, 'active-model.json'),
  }
}

const readSessionMarker = async (
  paths: VisualSessionPaths,
): Promise<VisualSessionMarker> => {
  let raw = ''
  try {
    raw = await readFile(paths.marker, 'utf8')
  } catch {
    throw storeError(
      'YMVS124',
      `Directory "${paths.root}" is not a marked visual session`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw storeError('YMVS124', `Session marker "${paths.marker}" is not JSON`)
  }
  const fields = documentFields(parsed)
  const id = fields.id
  const createdAt = fields.createdAt
  const authority = fields.authority
  if (
    fields.format !== VISUAL_SESSION_MARKER_FORMAT ||
    typeof id !== 'string' ||
    !IDENTIFIER.test(id) ||
    typeof createdAt !== 'string' ||
    !TIMESTAMP.test(createdAt) ||
    (authority !== 'canonical' && authority !== 'ad-hoc')
  ) {
    throw storeError(
      'YMVS124',
      `Session marker "${paths.marker}" is not ${VISUAL_SESSION_MARKER_FORMAT}`,
    )
  }
  // A marker that names another directory cannot authorise destructive work on
  // this one; it is either a copied session or a redirected cleanup target.
  if (basename(paths.root) !== id) {
    throw storeError(
      'YMVS125',
      `Session marker "${paths.marker}" names session "${id}" outside its own directory`,
    )
  }
  return { format: VISUAL_SESSION_MARKER_FORMAT, id, createdAt, authority }
}

/**
 * Reads the journal without mutating it. A torn final line is the expected
 * shape of a crash mid-append and is ignored; any complete line that is not a
 * valid protocol record means the journal was corrupted and is rejected.
 */
const readJournal = async (journal: string): Promise<JournalRead> => {
  let buffer: Buffer
  try {
    buffer = await readFile(journal)
  } catch {
    throw storeError('YMVS124', `Session journal "${journal}" is missing`)
  }
  const completeBytes = buffer.lastIndexOf(NEWLINE) + 1
  const lines =
    completeBytes === 0
      ? []
      : buffer
          .subarray(0, completeBytes - 1)
          .toString('utf8')
          .split('\n')
  const records: (VisualEvent | VisualResponse)[] = []
  let lastSequence = 0
  for (const [index, line] of lines.entries()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      throw storeError(
        'YMVS123',
        `Journal "${journal}" line ${index + 1} is not JSON`,
      )
    }
    const format = documentFields(parsed).format
    const result =
      format === 'yarramate/visual-event/v1'
        ? parseVisualEvent(parsed)
        : format === 'yarramate/visual-response/v1'
          ? parseVisualResponse(parsed)
          : undefined
    if (result === undefined) {
      throw storeError(
        'YMVS123',
        `Journal "${journal}" line ${index + 1} declares unknown format ${JSON.stringify(
          format,
        )}`,
      )
    }
    if (!result.ok) {
      throw storeError(
        'YMVS123',
        `Journal "${journal}" line ${index + 1} is not a valid record: ${
          result.diagnostics[0]?.message ?? 'unknown violation'
        }`,
      )
    }
    records.push(result.value)
    if (result.value.format === 'yarramate/visual-event/v1') {
      lastSequence = Math.max(lastSequence, result.value.sequence)
    }
  }
  return { records, lastSequence, completeBytes, size: buffer.byteLength }
}

/**
 * Append state for the session, reloaded whenever the journal on disk is not
 * the size this process last wrote — which covers a fresh process after a
 * restart as well as a crash that left a torn final line. The torn tail is
 * discarded here, on the append path only, so recovery stays read-only.
 */
const syncState = async (paths: VisualSessionPaths): Promise<JournalState> => {
  let size = 0
  try {
    size = (await stat(paths.journal)).size
  } catch {
    throw storeError('YMVS124', `Session journal "${paths.journal}" is missing`)
  }
  const cached = states.get(paths.journal)
  if (cached !== undefined && cached.bytes === size) {
    return cached
  }
  const marker = await readSessionMarker(paths)
  const journal = await readJournal(paths.journal)
  if (journal.completeBytes !== journal.size) {
    await truncate(paths.journal, journal.completeBytes)
  }
  const state: JournalState = {
    bytes: journal.completeBytes,
    lastSequence: journal.lastSequence,
    eventIds: new Set(
      journal.records
        .filter((record) => record.format === 'yarramate/visual-event/v1')
        .map((record) => record.eventId),
    ),
    responseIds: new Set(
      journal.records
        .filter((record) => record.format === 'yarramate/visual-response/v1')
        .map((record) => record.responseId),
    ),
    sessionId: marker.id,
  }
  states.set(paths.journal, state)
  return state
}

const writeJournalLine = async (journal: string, line: string) => {
  const handle = await open(journal, 'a')
  try {
    await handle.writeFile(line, { encoding: 'utf8' })
    await handle.sync()
  } finally {
    await handle.close()
  }
}

const overflowsTranscript = (
  paths: VisualSessionPaths,
  state: JournalState,
  bytes: number,
): VisualAppendRejected | undefined =>
  state.bytes + bytes > VISUAL_LIMITS.transcriptBytes
    ? {
        ok: false,
        freeze: 'transcript-bytes',
        diagnostics: [
          storeDiagnostic(
            'YMVS122',
            `Journaling ${bytes} more bytes would exceed the ${VISUAL_LIMITS.transcriptBytes} byte transcript limit`,
            paths.journal,
            '#/payload',
          ),
        ],
      }
    : undefined

export const createVisualSession = async (
  request: VisualSessionRequest,
  deps: SessionDependencies,
): Promise<VisualSessionCreated> => {
  const validated = parseVisualSessionRequest(request)
  if (!validated.ok) {
    const first = validated.diagnostics[0]
    throw storeError(
      first?.code ?? 'YMVS101',
      `Session request is invalid: ${first?.message ?? 'unknown violation'}`,
    )
  }
  const id = drawHex(deps.randomBytes, 16)
  await mkdir(deps.baseDir, { recursive: true, mode: 0o700 })
  const root = join(deps.baseDir, id)
  // recursive: false — a colliding directory is a live session or a capability
  // collision, never something to adopt.
  await mkdir(root, { recursive: false, mode: 0o700 })
  const paths = visualSessionPaths(root)
  await writePrivateJson(paths.marker, {
    format: VISUAL_SESSION_MARKER_FORMAT,
    id,
    createdAt: deps.now().toISOString(),
    authority: validated.value.authority,
  })
  await mkdir(paths.candidates, { recursive: false, mode: 0o700 })
  await writeFile(paths.journal, '', { mode: 0o600 })
  await syncDirectory(root)
  return {
    paths,
    browserToken: drawHex(deps.randomBytes, 32),
    agentToken: drawHex(deps.randomBytes, 32),
  }
}

/**
 * Publishes the agent's entry point into a live session. The descriptor is the
 * only file that carries the agent capability, so it is written with the same
 * private write-then-rename every other session document uses, and only after
 * the marker confirms the descriptor describes this session and no other.
 */
export const writeVisualSessionDescriptor = async (
  paths: VisualSessionPaths,
  descriptor: VisualSessionDescriptor,
): Promise<void> => {
  const validated = parseVisualSessionDescriptor(descriptor)
  if (!validated.ok) {
    const first = validated.diagnostics[0]
    throw storeError(
      first?.code ?? 'YMVS103',
      `Session descriptor is invalid: ${first?.message ?? 'unknown violation'}`,
    )
  }
  const marker = await readSessionMarker(paths)
  if (validated.value.sessionId !== marker.id) {
    throw storeError(
      'YMVS126',
      `Descriptor belongs to session "${validated.value.sessionId}", not "${marker.id}"`,
    )
  }
  if (
    validated.value.sessionRoot !== paths.root ||
    validated.value.journalPath !== paths.journal
  ) {
    throw storeError(
      'YMVS125',
      `Descriptor for session "${marker.id}" names artefacts outside "${paths.root}"`,
    )
  }
  await writePrivateJson(paths.descriptor, validated.value)
}

export const appendVisualEvent = async (
  paths: VisualSessionPaths,
  event: VisualEvent,
): Promise<VisualAppendResult> => {
  const validated = parseVisualEvent(event)
  if (!validated.ok) {
    return { ok: false, diagnostics: validated.diagnostics }
  }
  const record = validated.value
  return serialize(paths.journal, async () => {
    const state = await syncState(paths)
    if (record.sessionId !== state.sessionId) {
      return {
        ok: false,
        diagnostics: [
          storeDiagnostic(
            'YMVS126',
            `Event belongs to session "${record.sessionId}", not "${state.sessionId}"`,
            paths.journal,
            '#/sessionId',
          ),
        ],
      }
    }
    if (state.eventIds.has(record.eventId)) {
      return {
        ok: false,
        diagnostics: [
          storeDiagnostic(
            'YMVS127',
            `Event "${record.eventId}" was already journaled`,
            paths.journal,
            '#/eventId',
          ),
        ],
      }
    }
    if (record.sequence <= state.lastSequence) {
      return {
        ok: false,
        diagnostics: [
          storeDiagnostic(
            'YMVS121',
            `Event sequence ${record.sequence} does not advance past ${state.lastSequence}`,
            paths.journal,
            '#/sequence',
          ),
        ],
      }
    }
    const line = `${JSON.stringify(record)}\n`
    const bytes = Buffer.byteLength(line, 'utf8')
    const overflow = overflowsTranscript(paths, state, bytes)
    if (overflow !== undefined) {
      return overflow
    }
    await writeJournalLine(paths.journal, line)
    state.bytes += bytes
    state.lastSequence = record.sequence
    state.eventIds.add(record.eventId)
    return {
      ok: true,
      lastSequence: state.lastSequence,
      transcriptBytes: state.bytes,
      duplicate: false,
    }
  })
}

export const appendVisualResponse = async (
  paths: VisualSessionPaths,
  response: VisualResponse,
): Promise<VisualAppendResult> => {
  const validated = parseVisualResponse(response)
  if (!validated.ok) {
    return { ok: false, diagnostics: validated.diagnostics }
  }
  const record = validated.value
  return serialize(paths.journal, async () => {
    const state = await syncState(paths)
    if (record.sessionId !== state.sessionId) {
      return {
        ok: false,
        diagnostics: [
          storeDiagnostic(
            'YMVS126',
            `Response belongs to session "${record.sessionId}", not "${state.sessionId}"`,
            paths.journal,
            '#/sessionId',
          ),
        ],
      }
    }
    // A response the runtime already journaled must not be written twice: the
    // broadcast may be retried after a partial failure.
    if (state.responseIds.has(record.responseId)) {
      return {
        ok: true,
        lastSequence: state.lastSequence,
        transcriptBytes: state.bytes,
        duplicate: true,
      }
    }
    const line = `${JSON.stringify(record)}\n`
    const bytes = Buffer.byteLength(line, 'utf8')
    const overflow = overflowsTranscript(paths, state, bytes)
    if (overflow !== undefined) {
      return overflow
    }
    await writeJournalLine(paths.journal, line)
    state.bytes += bytes
    state.responseIds.add(record.responseId)
    return {
      ok: true,
      lastSequence: state.lastSequence,
      transcriptBytes: state.bytes,
      duplicate: false,
    }
  })
}

export const readActionableEventsAfter = async (
  paths: VisualSessionPaths,
  sequence: number,
): Promise<readonly VisualEvent[]> => {
  const journal = await readJournal(paths.journal)
  return journal.records.filter(
    (record): record is VisualEvent =>
      record.format === 'yarramate/visual-event/v1' &&
      record.sequence > sequence &&
      isActionableVisualEvent(record),
  )
}

export const recoverVisualSession = async (
  paths: VisualSessionPaths,
  includeTranscript = false,
): Promise<VisualHandoff> => {
  const marker = await readSessionMarker(paths)
  const journal = await readJournal(paths.journal)

  let summary: VisualHandoffSummary | undefined
  let endReason: 'user-ended' | 'browser-timeout' | undefined
  const visited: string[] = []
  for (const record of journal.records) {
    if (
      record.format === 'yarramate/visual-response/v1' &&
      record.type === 'handoff.complete'
    ) {
      summary = record.payload
    }
    if (record.format === 'yarramate/visual-event/v1') {
      if (record.type === 'session.end') {
        endReason = record.payload.reason
      }
      if (
        record.type === 'view.navigate' &&
        !visited.includes(record.payload.viewId)
      ) {
        visited.push(record.payload.viewId)
      }
    }
  }

  // Every combination below satisfies the protocol's cross-field rule: only a
  // completed handoff may report `user-ended`, and that requires a summary the
  // child actually submitted.
  const terminationReason: VisualTerminationReason =
    endReason === 'browser-timeout'
      ? 'browser-timeout'
      : endReason === 'user-ended' && summary !== undefined
        ? 'user-ended'
        : endReason === 'user-ended'
          ? 'child-failed'
          : 'server-failed'
  const decision: VisualHandoffDecision =
    summary === undefined
      ? 'failed'
      : terminationReason === 'user-ended'
        ? 'completed'
        : 'cancelled'

  const last = journal.records.at(-1)
  const handoff: VisualHandoff = {
    format: 'yarramate/visual-handoff/v1',
    sessionId: marker.id,
    authority: marker.authority,
    decision,
    terminationReason,
    lastSequence: journal.lastSequence,
    summary:
      summary?.summary ??
      'No agent handoff was journaled; this summary was reconstructed from the session journal.',
    confirmedDecisions: summary?.confirmedDecisions ?? [],
    requestedChanges: summary?.requestedChanges ?? [],
    unresolvedQuestions: summary?.unresolvedQuestions ?? [],
    finalViews: summary?.finalViews ?? visited.slice(-256),
    transcriptPath: paths.journal,
    completedAt: last?.timestamp ?? marker.createdAt,
    // Present and undefined rather than absent, so a caller cannot mistake the
    // summary-only handoff for one whose transcript it forgot to read.
    transcript: includeTranscript
      ? // The submitted summary is the handoff itself, not conversation, so it
        // is not repeated inside the raw transcript.
        journal.records.filter(
          (record) =>
            record.format !== 'yarramate/visual-response/v1' ||
            record.type !== 'handoff.complete',
        )
      : undefined,
  }

  // The transcript is excluded from validation on purpose: the 5 MiB cap is
  // enforced on the journal at append time, and re-serializing a whole journal
  // as a JSON array costs one byte more than the file it came from. Every entry
  // was validated on the way in and again by readJournal.
  const validated = parseVisualHandoff({ ...handoff, transcript: undefined })
  if (!validated.ok) {
    const first = validated.diagnostics[0]
    throw storeError(
      first?.code ?? 'YMVS107',
      `Recovered handoff for "${paths.root}" is invalid: ${
        first?.message ?? 'unknown violation'
      }`,
    )
  }
  return handoff
}

export const readActiveVisualModel = async (
  paths: VisualSessionPaths,
): Promise<VisualActiveModel | undefined> => {
  let raw = ''
  try {
    raw = await readFile(paths.activeModel, 'utf8')
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw storeError(
      'YMVS128',
      `Active model pointer "${paths.activeModel}" is not JSON`,
    )
  }
  const fields = documentFields(parsed)
  const candidate = fields.candidate
  const authority = fields.authority
  const initialView = fields.initialView
  const promotedAt = fields.promotedAt
  if (
    fields.format !== VISUAL_ACTIVE_MODEL_FORMAT ||
    typeof candidate !== 'string' ||
    !CANDIDATE_NAME.test(candidate) ||
    (authority !== 'canonical' && authority !== 'ad-hoc') ||
    typeof initialView !== 'string' ||
    typeof promotedAt !== 'string' ||
    !TIMESTAMP.test(promotedAt)
  ) {
    throw storeError(
      'YMVS128',
      `Active model pointer "${paths.activeModel}" is not ${VISUAL_ACTIVE_MODEL_FORMAT}`,
    )
  }
  return {
    format: VISUAL_ACTIVE_MODEL_FORMAT,
    candidate,
    authority,
    initialView,
    promotedAt,
  }
}

export const promoteCompiledModel = async (
  paths: VisualSessionPaths,
  promotion: ModelPromotion,
): Promise<ModelPromotionResult> => {
  // The runtime has already parsed the `model.replace` response that carried
  // this model, so a violation here is a runtime defect rather than untrusted
  // input, and must not be reported to the browser as a candidate diagnostic.
  const validated = parseVisualModel(promotion.model)
  if (!validated.ok) {
    const first = validated.diagnostics[0]
    throw storeError(
      first?.code ?? 'YMVS106',
      `Candidate model is invalid: ${first?.message ?? 'unknown violation'}`,
    )
  }
  const model = validated.value
  return serialize(paths.candidates, async () => {
    await readSessionMarker(paths)
    const existing = await readdir(paths.candidates)
    const highest = existing
      .filter((entry) => CANDIDATE_NAME.test(entry))
      .reduce((max, entry) => Math.max(max, Number(entry)), 0)
    const candidate = String(highest + 1).padStart(6, '0')
    const candidateDir = join(paths.candidates, candidate)
    await mkdir(candidateDir, { recursive: false, mode: 0o700 })
    for (const [file, contents] of Object.entries(model.files)) {
      const target = resolve(candidateDir, file)
      // Confinement is already enforced by the model schema and by the protocol
      // path check; re-checking the resolved path means neither of those alone
      // is load-bearing for a write outside the candidate directory.
      if (!target.startsWith(`${candidateDir}${sep}`)) {
        throw storeError(
          'YMVS125',
          `Candidate file "${file}" resolves outside "${candidateDir}"`,
        )
      }
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await writePrivateFile(target, contents)
    }
    const diagnostics = await promotion.compile(candidateDir)
    if (diagnostics.length > 0) {
      return { promoted: false, candidate, candidateDir, diagnostics }
    }
    await writePrivateJson(paths.activeModel, {
      format: VISUAL_ACTIVE_MODEL_FORMAT,
      candidate,
      authority: model.authority,
      initialView: model.initialView,
      promotedAt: promotion.now().toISOString(),
    })
    return { promoted: true, candidate, candidateDir, diagnostics: [] }
  })
}

/**
 * Recovers the handoff and only then deletes the session, so cleanup can never
 * be the step that loses confirmed state. Returns `undefined` when the session
 * is already gone, which makes a repeated stop idempotent.
 */
export const removeVisualSession = async (
  paths: VisualSessionPaths,
  includeTranscript = false,
): Promise<VisualHandoff | undefined> => {
  let entry
  try {
    entry = await lstat(paths.root)
  } catch {
    forget(paths)
    return undefined
  }
  if (!entry.isDirectory()) {
    throw storeError(
      'YMVS125',
      `Session root "${paths.root}" is not a directory`,
    )
  }
  const handoff = await recoverVisualSession(paths, includeTranscript)
  await rm(paths.root, { recursive: true, force: true })
  await syncDirectory(dirname(paths.root))
  forget(paths)
  return handoff
}

/**
 * Removes orphaned sessions a previous runtime left behind. Only directories
 * carrying a marker that names them are touched, and never more than `limit`
 * per pass; the oldest go first.
 */
export const pruneStaleVisualSessions = async (
  baseDir: string,
  now: Date,
  limit = VISUAL_SESSION_PRUNE_LIMIT,
): Promise<readonly string[]> => {
  let entries
  try {
    entries = await readdir(baseDir, { withFileTypes: true })
  } catch {
    return []
  }
  const stale: { readonly root: string; readonly createdAt: number }[] = []
  for (const entry of entries) {
    // Dirent reflects lstat, so a symlink pointing at a directory outside the
    // base directory is never a candidate for removal.
    if (!entry.isDirectory()) {
      continue
    }
    const paths = visualSessionPaths(join(baseDir, entry.name))
    let marker
    try {
      marker = await readSessionMarker(paths)
    } catch {
      continue
    }
    const createdAt = Date.parse(marker.createdAt)
    if (now.getTime() - createdAt <= VISUAL_LIMITS.staleSessionMs) {
      continue
    }
    stale.push({ root: paths.root, createdAt })
  }
  stale.sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.root.localeCompare(right.root),
  )
  const removed: string[] = []
  for (const candidate of stale.slice(0, Math.max(0, limit))) {
    await rm(candidate.root, { recursive: true, force: true })
    forget(visualSessionPaths(candidate.root))
    removed.push(candidate.root)
  }
  if (removed.length > 0) {
    await syncDirectory(baseDir)
  }
  return removed
}
