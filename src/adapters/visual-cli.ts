#!/usr/bin/env node

import { join } from 'node:path'
import { isMainModule, versionResult, type CliResult } from '../cli-support.js'
import {
  fetchVisualStatus,
  readVisualJsonDocument,
  readVisualSessionDescriptor,
  recoverVisualSessionClient,
  sendVisualResponse,
  stopVisualSessionClient,
  visualClientDiagnostic,
  visualFailureDiagnostics,
  visualSessionAlreadyStopped,
  waitForVisualEvent,
} from './visual/client.js'
import {
  parseVisualResponse,
  parseVisualSessionRequest,
  type VisualDiagnostic,
  type VisualTerminationReason,
} from './visual/protocol.js'
import { startVisualServer } from './visual/session-server.js'
import { pruneStaleVisualSessions } from './visual/session-store.js'

export const visualUsage =
  'Usage:\n' +
  '  yarramate-visual start <request.json>\n' +
  '  yarramate-visual wait <descriptor.json> [--after <sequence>]\n' +
  '  yarramate-visual respond <descriptor.json> <response.json>\n' +
  '  yarramate-visual status <descriptor.json>\n' +
  '  yarramate-visual recover <descriptor.json> [--transcript]\n' +
  '  yarramate-visual stop <descriptor.json> [--transcript]\n' +
  '  yarramate-visual --version\n'

/**
 * Where a repository keeps its live sessions, one directory per session. It sits
 * under the ignored build directory because a session is runtime state: never
 * canonical, never committed, and pruned by the next start.
 */
export const VISUAL_SESSION_DIRECTORY = join('.yarramate-out', 'visual')

/** Terminations that mean the session did not end the way it was asked to. */
const FAILED_TERMINATION: Readonly<
  Partial<Record<VisualTerminationReason, true>>
> = {
  'child-failed': true,
  'server-failed': true,
  'compiler-failed': true,
}

const usageResult: CliResult = {
  exitCode: 2,
  stdout: '',
  stderr: visualUsage,
}

/**
 * One document per line: every command an agent drives writes at most one
 * versioned document, so a caller reads exactly one line per invocation.
 */
const documentLine = (value: unknown) => `${JSON.stringify(value)}\n`

/**
 * Stdout carries the document that was asked for and nothing else, so a refusal
 * goes to stderr where it cannot be mistaken for an answer.
 */
const refusalResult = (
  diagnostics: readonly VisualDiagnostic[],
): CliResult => ({
  exitCode: 1,
  stdout: '',
  stderr: documentLine({
    format: 'yarramate/visual-diagnostic-result/v1',
    diagnostics,
  }),
})

/** Sequences are counted, so only a plain non-negative integer is one. */
const sequenceFlag = (rest: readonly string[]): number | undefined => {
  if (rest.length === 0) return 0
  const [flag, value] = rest
  if (flag !== '--after' || value === undefined || rest.length !== 2) {
    return undefined
  }
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return undefined
  const sequence = Number(value)
  return Number.isSafeInteger(sequence) ? sequence : undefined
}

const transcriptFlag = (rest: readonly string[]): boolean | undefined =>
  rest.length === 0
    ? false
    : rest.length === 1 && rest[0] === '--transcript'
      ? true
      : undefined

const waitCliCommand = async (
  descriptorPath: string,
  rest: readonly string[],
  cwd: string,
): Promise<CliResult> => {
  const after = sequenceFlag(rest)
  if (after === undefined) return usageResult
  const descriptor = await readVisualSessionDescriptor(descriptorPath, cwd)
  if (!descriptor.ok) return refusalResult(descriptor.diagnostics)
  const delivery = await waitForVisualEvent(descriptor.value, after)
  if (!delivery.ok) return refusalResult(delivery.diagnostics)
  return {
    exitCode: 0,
    // An idle window is not a failure and has no document: the caller polls
    // again from the sequence it already knows.
    stdout: delivery.value.waiting ? '' : documentLine(delivery.value.event),
    stderr: '',
  }
}

const respondCliCommand = async (
  descriptorPath: string,
  rest: readonly string[],
  cwd: string,
): Promise<CliResult> => {
  const [responsePath, ...trailing] = rest
  if (responsePath === undefined || trailing.length > 0) return usageResult
  const descriptor = await readVisualSessionDescriptor(descriptorPath, cwd)
  if (!descriptor.ok) return refusalResult(descriptor.diagnostics)
  const document = await readVisualJsonDocument(responsePath, cwd)
  if (!document.ok) return refusalResult(document.diagnostics)
  // Validated here as well as by the runtime, so an invalid response never
  // reaches the session at all.
  const response = parseVisualResponse(document.value)
  if (!response.ok) return refusalResult(response.diagnostics)
  const accepted = await sendVisualResponse(descriptor.value, response.value)
  if (!accepted.ok) return refusalResult(accepted.diagnostics)
  return { exitCode: 0, stdout: documentLine(accepted.value), stderr: '' }
}

const statusCliCommand = async (
  descriptorPath: string,
  rest: readonly string[],
  cwd: string,
): Promise<CliResult> => {
  if (rest.length > 0) return usageResult
  const descriptor = await readVisualSessionDescriptor(descriptorPath, cwd)
  if (!descriptor.ok) return refusalResult(descriptor.diagnostics)
  const status = await fetchVisualStatus(descriptor.value)
  if (!status.ok) return refusalResult(status.diagnostics)
  return { exitCode: 0, stdout: documentLine(status.value), stderr: '' }
}

const recoverCliCommand = async (
  descriptorPath: string,
  rest: readonly string[],
  cwd: string,
): Promise<CliResult> => {
  const includeTranscript = transcriptFlag(rest)
  if (includeTranscript === undefined) return usageResult
  const descriptor = await readVisualSessionDescriptor(descriptorPath, cwd)
  if (!descriptor.ok) return refusalResult(descriptor.diagnostics)
  const handoff = await recoverVisualSessionClient(
    descriptor.value,
    includeTranscript,
  )
  if (!handoff.ok) return refusalResult(handoff.diagnostics)
  return { exitCode: 0, stdout: documentLine(handoff.value), stderr: '' }
}

/**
 * Converges the session on stopped, and says so however many times it is asked.
 * The design's failure table requires a repeated stop to report the
 * already-stopped state, and the first stop takes the descriptor with the
 * session root, so the second invocation has nothing left to read. That one
 * shape — descriptor and session root both gone — reports the same benign
 * already-stopped result the client returns for a retained descriptor: exit 0,
 * no handoff document, because there is no session left to hand off.
 *
 * Every other unreadable descriptor still refuses. Nothing weakens: no
 * credential is retained, no directory is removed on the strength of a
 * descriptor that did not parse, and a corrupt, redirected, or foreign
 * descriptor fails exactly as before.
 */
const stopCliCommand = async (
  descriptorPath: string,
  rest: readonly string[],
  cwd: string,
): Promise<CliResult> => {
  const includeTranscript = transcriptFlag(rest)
  if (includeTranscript === undefined) return usageResult
  const descriptor = await readVisualSessionDescriptor(descriptorPath, cwd)
  if (!descriptor.ok) {
    return (await visualSessionAlreadyStopped(descriptorPath, cwd))
      ? { exitCode: 0, stdout: '', stderr: '' }
      : refusalResult(descriptor.diagnostics)
  }
  const stopped = await stopVisualSessionClient(
    descriptor.value,
    includeTranscript,
  )
  if (!stopped.ok) return refusalResult(stopped.diagnostics)
  return {
    exitCode: 0,
    // A session that was already gone has no handoff left to publish.
    stdout: stopped.value === undefined ? '' : documentLine(stopped.value),
    stderr: '',
  }
}

/**
 * Every command an agent can run to completion. `start` is not one of them: it
 * blocks for the life of the session and is dispatched by `runVisualCli`.
 */
export async function runVisualClientCli(
  args: readonly string[],
  cwd: string = process.cwd(),
): Promise<CliResult> {
  const [command, descriptor, ...rest] = args
  if (command === '--version') return versionResult('yarramate-visual')
  if (descriptor === undefined) return usageResult
  switch (command) {
    case 'wait':
      return waitCliCommand(descriptor, rest, cwd)
    case 'respond':
      return respondCliCommand(descriptor, rest, cwd)
    case 'status':
      return statusCliCommand(descriptor, rest, cwd)
    case 'recover':
      return recoverCliCommand(descriptor, rest, cwd)
    case 'stop':
      return stopCliCommand(descriptor, rest, cwd)
    default:
      return usageResult
  }
}

/** Where a foreground session publishes, and where it observes its signals. */
export interface VisualSignalSource {
  on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  off(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
}

export interface VisualStartIo {
  readonly stdout: (chunk: string) => void
  readonly stderr: (chunk: string) => void
  /** Defaults to the process itself. */
  readonly signals?: VisualSignalSource
}

const processIo: VisualStartIo = {
  stdout: (chunk) => void process.stdout.write(chunk),
  stderr: (chunk) => void process.stderr.write(chunk),
}

/**
 * Serves one visual session in the foreground.
 *
 * The request is validated before any filesystem or network effect, so a bad
 * document costs nothing. Exactly one public `visual-session-started/v1` line is
 * published before the command blocks — it names the private descriptor but
 * never carries the agent capability, which lives only in that mode 0600 file.
 * The command then holds the session open until the runtime closes it, whether
 * that is a signal, an agent stop, or a runtime failure; the runtime recovers
 * the handoff before it removes the session in every one of those cases.
 */
export const runVisualStart = async (
  requestPath: string,
  cwd: string = process.cwd(),
  io: VisualStartIo = processIo,
): Promise<CliResult> => {
  const document = await readVisualJsonDocument(requestPath, cwd)
  if (!document.ok) return refusalResult(document.diagnostics)
  const request = parseVisualSessionRequest(document.value)
  if (!request.ok) return refusalResult(request.diagnostics)

  const baseDir = join(cwd, VISUAL_SESSION_DIRECTORY)
  const signals = io.signals ?? process
  let handle
  try {
    // A previous runtime's orphans are collected on the critical path of a new
    // session, bounded per pass so a full directory cannot stall this one.
    await pruneStaleVisualSessions(baseDir, new Date())
    handle = await startVisualServer({ request: request.value, baseDir })
  } catch (cause) {
    // A failed start has already recovered and removed whatever it created.
    return refusalResult(visualFailureDiagnostics(cause))
  }

  io.stdout(documentLine(handle.started))

  // One handler for both signals: `stop` converges on the first reason it is
  // given, so a repeated or second signal is absorbed rather than racing.
  //
  // A signal is not a caller, and nothing here awaits the teardown it starts:
  // a stop that fails is observed rather than left to reach the runtime as an
  // unhandled rejection and take the whole session down with it. What it could
  // not tear down is still up, this command is still blocked on `closed`, and
  // the next signal runs the teardown again.
  const interrupt = () => {
    void handle.stop('main-cancelled').catch(() => undefined)
  }
  signals.on('SIGINT', interrupt)
  signals.on('SIGTERM', interrupt)
  try {
    const closed = await handle.closed
    // The recovered handoff is what the journal says happened; the reason the
    // stop asked for is only what someone wanted. A session the reviewer ended
    // is a success even when a cancelling agent is what closed the server, and
    // a child that died before its handoff is a failure even when it did not.
    const outcome = closed.handoff?.terminationReason ?? closed.reason
    return FAILED_TERMINATION[outcome] === true
      ? refusalResult([
          visualClientDiagnostic(
            'YMVS409',
            `Visual session ${handle.started.sessionId} ended with termination reason "${outcome}"`,
          ),
        ])
      : { exitCode: 0, stdout: '', stderr: '' }
  } finally {
    signals.off('SIGINT', interrupt)
    signals.off('SIGTERM', interrupt)
  }
}

/**
 * The whole binary: `start` blocks and streams its one document through `io`,
 * every other command runs to completion and returns its document.
 */
export const runVisualCli = async (
  args: readonly string[],
  cwd: string = process.cwd(),
  io: VisualStartIo = processIo,
): Promise<CliResult> => {
  if (args[0] !== 'start') return runVisualClientCli(args, cwd)
  const requestPath = args[1]
  if (requestPath === undefined || args.length !== 2) return usageResult
  return runVisualStart(requestPath, cwd, io)
}

if (isMainModule(import.meta.url, process.argv[1])) {
  void runVisualCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)
    process.exitCode = result.exitCode
  })
}
