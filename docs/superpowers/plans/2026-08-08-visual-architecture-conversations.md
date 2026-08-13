# Visual Architecture Conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `yarramate-visual` sibling binary and guided skill journey that render checked or explicitly ad hoc LikeC4 explanations in a custom browser application, support delegated browser chat when the harness can provide it, and always recover control to the main agent.

**Architecture:** `yarramate-visual` is a deep runtime module behind six blocking CLI commands: `start`, `wait`, `respond`, `status`, `recover`, and `stop`. It owns a localhost HTTP/WebSocket server, append-only session journal, LikeC4 compiler adapter, prebuilt React renderer, recovery, and cleanup; the canonical skill owns authority checks, capability detection, delegation, and main-agent handoff. Browser and child-agent inputs are untrusted and can mutate only a permission-restricted temporary visual session.

**Tech Stack:** Node.js 22, TypeScript 7, Vitest, AJV 2020-12 JSON Schema, Node `http`/`crypto`/`fs`, `ws`, React 19, Vite 8, LikeC4 1.59 public model/React interfaces.

## Global Constraints

- Keep the public entry point in `yarramate-architecture`; do not add a visual subcommand to the tool-neutral `yarramate` CLI.
- Ship `yarramate-visual` beside `yarramate-likec4` in the existing `yarramate` package.
- Repository-architecture views require a passing workspace and facts from `yarramate ask --json`; a missing or invalid model routes to discovery.
- Label question/choice models `ad-hoc` and non-canonical; never promote browser content into `.yarramate/` automatically.
- The delegated visual agent may write only through the visual-session interface into its temporary directory.
- Bind only to `127.0.0.1` on an OS-assigned random port; use separate browser and agent capabilities.
- Initial compiler compatibility is `likec4 >=1.59.2 <1.60.0`; the consented fallback is pinned to `likec4@1.59.2`.
- Starting the visual feature with the pinned compiler requires Node.js `>=22.22.3`; existing semantic binaries keep the current package floor.
- One main conversation owns at most one visual session, one delegated child, and one in-flight chat turn.
- Accept only complete `yarramate/visual-model/v1` replacements; preserve the last valid rendered model on compilation failure.
- Limit chat messages to 64 KiB, complete candidate models to 5 MiB, raw transcripts to 5 MiB, and pending chat events to 32.
- Browser disconnect grace is five minutes; stale marked session directories are pruned after 24 hours.
- Default recovery returns a structured summary and temporary transcript handle; return the raw transcript only on request.
- End, failure, or main-agent interruption must recover first, stop the entire server process tree, and remove temporary files.
- If the harness cannot guarantee delegation, blocking child calls, completion delivery, and parent interruption, use diagram-only mode.
- Browser assets are self-contained: no external scripts, fonts, telemetry, or model-provider credentials.

---

## File Structure

### Runtime and protocol

- `src/adapters/visual/protocol.ts` — TypeScript protocol types, AJV validators, limits, and diagnostic conversion.
- `src/adapters/visual/session-store.ts` — temporary session layout, append-only journal, recovery, atomic model pointers, and stale-session pruning.
- `src/adapters/visual/likec4-compiler.ts` — trusted command-vector execution, LikeC4 validation/export, candidate staging, and last-good promotion.
- `src/adapters/visual/session-server.ts` — localhost HTTP/WebSocket server, authentication, queueing, long-poll agent endpoint, static assets, and shutdown.
- `src/adapters/visual/client.ts` — one-shot agent clients used by `wait`, `respond`, `status`, `recover`, and `stop`.
- `src/adapters/visual-cli.ts` — executable parsing, foreground `start`, one-shot command dispatch, version, usage, and process signals.

### Browser application

- `src/visual-app/index.html` — Vite entry document.
- `src/visual-app/main.tsx` — React bootstrap and providers.
- `src/visual-app/App.tsx` — diagram, authority/description, navigation, chat, choices, status, and End layout.
- `src/visual-app/session-client.tsx` — bootstrap fetch, authenticated WebSocket lifecycle, reconnect, and event sends.
- `src/visual-app/state.ts` — DOM-free reducer for deterministic browser state transitions.
- `src/visual-app/styles.css` — self-contained responsive layout and status styling.
- `vite.visual.config.ts` — prebuilt browser bundle to `dist/visual-app`.
- `tsconfig.visual.json` — React/DOM typecheck boundary without changing Node compilation.

### Schemas

- `schema/yarramate-visual-session-request.schema.json`
- `schema/yarramate-visual-session-started.schema.json`
- `schema/yarramate-visual-session-descriptor.schema.json`
- `schema/yarramate-visual-event.schema.json`
- `schema/yarramate-visual-response.schema.json`
- `schema/yarramate-visual-model.schema.json`
- `schema/yarramate-visual-handoff.schema.json`
- `schema/yarramate-visual-status.schema.json`
- `schema/yarramate-visual-diagnostic-result.schema.json`

### Tests and fixtures

- `test/visual-protocol.test.ts`
- `test/visual-session-store.test.ts`
- `test/visual-likec4-compiler.test.ts`
- `test/visual-session-server.test.ts`
- `test/visual-cli.test.ts`
- `test/visual-app-state.test.ts`
- `test/visual-journey.test.ts`
- `test/fixtures/visual/fake-likec4.mjs`
- `test/fixtures/visual/model.json`
- `test/fixtures/visual/browser-assets/index.html`

### Guided journey, packaging, and model

- `skills/yarramate-architecture/SKILL.md` — visual-request branch and handoff rules.
- `skills/yarramate-architecture/references/visual-conversations.md` — complete capability/preflight/delegation loop.
- `docs/CONSUMING-YARRAMATE.md` — user-facing visual conversation and fallback guidance.
- `package.json` — binary, schemas, build scripts, browser dependencies, and package surface.
- `.yarramate/architecture/engine.yaml` — visual runtime, functions, services, and data objects.
- `.yarramate/architecture/repository.yaml` — new source, schema, fixture, test, and skill-reference artifacts.
- `.yarramate/evidence/repository.yaml` — implementation evidence for new current subjects.
- `.yarramate/projections/visual-conversation-path.yaml` — bounded visual-session story.
- `.yarramate/likec4-project.yaml` — include the visual-session projection.
- `.yarramate/integrations/likec4/subject-mapping.yaml` — synchronized mappings for new subjects.
- `test/package-consumer.test.ts`, `test/self-model.test.ts` — packed and modeled product contracts.

---

### Task 1: Versioned visual protocol and schemas

**Files:**
- Create: `src/adapters/visual/protocol.ts`
- Create: `schema/yarramate-visual-session-request.schema.json`
- Create: `schema/yarramate-visual-session-started.schema.json`
- Create: `schema/yarramate-visual-session-descriptor.schema.json`
- Create: `schema/yarramate-visual-event.schema.json`
- Create: `schema/yarramate-visual-response.schema.json`
- Create: `schema/yarramate-visual-model.schema.json`
- Create: `schema/yarramate-visual-handoff.schema.json`
- Create: `schema/yarramate-visual-status.schema.json`
- Create: `schema/yarramate-visual-diagnostic-result.schema.json`
- Create: `test/visual-protocol.test.ts`
- Modify: `package.json:35-75`

**Interfaces:**
- Produces: `VisualCompilerCommand`, `VisualSessionRequest`, `VisualSessionStarted`, `VisualSessionDescriptor`, `VisualBrowserInput`, `VisualEvent`, `VisualResponse`, `VisualModel`, `VisualHandoff`, `VisualStatus`, `VisualDiagnostic`, `VISUAL_LIMITS`, and `parseVisual*` validators.
- Consumes: existing AJV 2020 import/configuration and `CliResult` diagnostic conventions.

- [ ] **Step 1: Write failing protocol tests**

Create fixtures that exercise one valid document of every format, every event/response discriminant, unsafe visual-model paths, cross-field authority requirements, unknown properties, and exact limits.

```ts
import { describe, expect, it } from 'vitest'
import {
  parseVisualModel,
  parseVisualSessionRequest,
  VISUAL_LIMITS,
} from '../src/adapters/visual/protocol.js'

const model = {
  format: 'yarramate/visual-model/v1',
  authority: 'ad-hoc',
  initialView: 'choices',
  sourceDigests: {},
  files: {
    'likec4.config.json': '{"name":"visual"}',
    'model.likec4': 'model { system = system "System" }',
    'views.likec4': 'views { view choices { include * } }',
  },
} as const

describe('visual protocol', () => {
  it('accepts a complete safe session request', () => {
    expect(parseVisualSessionRequest({
      format: 'yarramate/visual-session-request/v1',
      authority: 'ad-hoc',
      title: 'Choose a delivery design',
      description: 'Temporary non-canonical comparison',
      chatEnabled: true,
      compiler: { command: '/usr/bin/node', args: ['fake-likec4.mjs'] },
      initialModel: model,
    })).toMatchObject({ ok: true })
  })

  it.each(['../secret.likec4', '/tmp/secret.likec4', 'asset.js'])(
    'rejects unsafe model file %s',
    (path) => {
      expect(parseVisualModel({ ...model, files: { [path]: 'x' } })).toMatchObject({
        ok: false,
      })
    },
  )

  it('rejects messages over the exact limit', () => {
    expect(VISUAL_LIMITS.messageBytes).toBe(64 * 1024)
  })
})
```

- [ ] **Step 2: Run the protocol test and confirm red**

Run: `pnpm exec vitest run test/visual-protocol.test.ts`

Expected: FAIL because `src/adapters/visual/protocol.ts` and schemas do not exist.

- [ ] **Step 3: Add the nine strict JSON Schemas and TypeScript validators**

Use Draft 2020-12, `additionalProperties: false`, exact `format` constants, discriminated `oneOf` payloads, and `$defs` for reusable IDs, sequence numbers, capabilities, compiler vectors, diagnostics, and handoff decisions. Export every schema through `package.json` under `./schema/visual-*`.

```ts
export const VISUAL_LIMITS = {
  messageBytes: 64 * 1024,
  modelBytes: 5 * 1024 * 1024,
  transcriptBytes: 5 * 1024 * 1024,
  pendingEvents: 32,
  reconnectMs: 5 * 60 * 1000,
  staleSessionMs: 24 * 60 * 60 * 1000,
} as const

export interface VisualModel {
  readonly format: 'yarramate/visual-model/v1'
  readonly authority: 'canonical' | 'ad-hoc'
  readonly initialView: string
  readonly sourceDigests: Readonly<Record<string, string>>
  readonly files: Readonly<Record<string, string>>
}

export interface VisualCompilerCommand {
  readonly command: string
  readonly args: readonly string[]
}

export interface VisualSessionRequest {
  readonly format: 'yarramate/visual-session-request/v1'
  readonly authority: VisualModel['authority']
  readonly title: string
  readonly description: string
  readonly chatEnabled: boolean
  readonly compiler: VisualCompilerCommand
  readonly initialModel: VisualModel
}

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly VisualDiagnostic[] }

export const parseVisualSessionRequest = (
  input: unknown,
): ParseResult<VisualSessionRequest> => parseWith(
  validateVisualSessionRequest,
  input,
  'YMVS101',
)
```

Path validation must normalize POSIX separators and reject absolute paths, `..`, empty segments, symlink declarations, and extensions other than `.c4`, `.likec4`, plus the exact root file `likec4.config.json`. Enforce byte limits with `Buffer.byteLength`, not JavaScript character counts.

- [ ] **Step 4: Run protocol tests and typecheck**

Run: `pnpm exec vitest run test/visual-protocol.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the protocol contract**

```bash
git add package.json schema/yarramate-visual-*.schema.json src/adapters/visual/protocol.ts test/visual-protocol.test.ts
git commit -m "feat: define visual session protocol"
```

---

### Task 2: Permission-restricted session journal and recovery

**Files:**
- Create: `src/adapters/visual/session-store.ts`
- Create: `test/visual-session-store.test.ts`

**Interfaces:**
- Consumes: Task 1 `VisualSessionRequest`, `VisualEvent`, `VisualResponse`, `VisualHandoff`, `VisualModel`, and `VISUAL_LIMITS`.
- Produces: `createVisualSession`, `appendVisualEvent`, `appendVisualResponse`, `readActionableEventsAfter`, `recoverVisualSession`, `promoteCompiledModel`, `pruneStaleVisualSessions`, `removeVisualSession`, and `VisualSessionPaths`.

- [ ] **Step 1: Write failing store tests for journal durability and cleanup**

```ts
it('recovers accepted events and the summary without exposing the transcript', async () => {
  const session = await createVisualSession(request, {
    baseDir: parent,
    now: () => new Date('2026-08-08T00:00:00.000Z'),
    randomBytes: () => Buffer.alloc(32, 7),
  })
  await appendVisualEvent(session.paths, chatEvent)
  await appendVisualResponse(session.paths, chatResponse)
  await appendVisualResponse(session.paths, handoffResponse)

  expect(await recoverVisualSession(session.paths, false)).toMatchObject({
    format: 'yarramate/visual-handoff/v1',
    summary: handoffResponse.payload.summary,
    transcript: undefined,
    lastSequence: 1,
  })
  expect(await recoverVisualSession(session.paths, true)).toMatchObject({
    transcript: [chatEvent, chatResponse],
  })
})

it('prunes only marked sessions older than 24 hours', async () => {
  const removed = await pruneStaleVisualSessions(parent, staleNow)
  expect(removed).toEqual([session.paths.root])
  expect(existsSync(unmarkedDirectory)).toBe(true)
})
```

Also assert directory mode `0700`, descriptor/journal mode `0600` on POSIX, append ordering, recovery after a truncated final journal line, duplicate response idempotence, and exact 5 MiB transcript freeze behavior.

- [ ] **Step 2: Run the store test and confirm red**

Run: `pnpm exec vitest run test/visual-session-store.test.ts`

Expected: FAIL because `session-store.ts` does not exist.

- [ ] **Step 3: Implement the session filesystem and append-only journal**

```ts
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

export async function createVisualSession(
  request: VisualSessionRequest,
  deps: SessionDependencies,
): Promise<{
  readonly paths: VisualSessionPaths
  readonly browserToken: string
  readonly agentToken: string
}> {
  const id = deps.randomBytes(16).toString('hex')
  const root = join(deps.baseDir, id)
  await mkdir(root, { recursive: false, mode: 0o700 })
  await writePrivateJson(join(root, 'session.json'), {
    format: 'yarramate/visual-session-marker/v1',
    id,
    createdAt: deps.now().toISOString(),
  })
  await writeFile(join(root, 'journal.jsonl'), '', { mode: 0o600 })
  return {
    paths: visualSessionPaths(root),
    browserToken: deps.randomBytes(32).toString('hex'),
    agentToken: deps.randomBytes(32).toString('hex'),
  }
}
```

Append each JSON record as one UTF-8 line through a serialized per-session write queue. Ignore only a truncated last line during recovery; reject malformed complete lines. Stage model candidates under monotonically named directories and update `active-model.json` through write-then-rename after compilation succeeds.

- [ ] **Step 4: Run store tests and typecheck**

Run: `pnpm exec vitest run test/visual-session-store.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the durable session store**

```bash
git add src/adapters/visual/session-store.ts test/visual-session-store.test.ts
git commit -m "feat: add recoverable visual sessions"
```

---

### Task 3: Trusted LikeC4 compiler adapter

**Files:**
- Create: `src/adapters/visual/likec4-compiler.ts`
- Create: `test/visual-likec4-compiler.test.ts`
- Create: `test/fixtures/visual/fake-likec4.mjs`
- Create: `test/fixtures/visual/model.json`

**Interfaces:**
- Consumes: Task 1 `VisualCompilerCommand`, `VisualModel`, and `VisualDiagnostic`; Task 2 candidate paths and promotion function.
- Produces: `compileVisualModel`, `CompiledVisualModel`, and `LikeC4CompilationResult`.

- [ ] **Step 1: Write failing compiler tests**

Cover valid compilation, non-zero validation, malformed JSON export, process abort, absolute command enforcement, and last-good preservation.

```ts
it('validates, exports, and promotes one complete visual model', async () => {
  const result = await compileVisualModel({
    model,
    command: { command: process.execPath, args: [fakeLikeC4] },
    paths: session.paths,
  })

  expect(result).toMatchObject({
    ok: true,
    compiled: {
      initialView: 'choices',
      authority: 'ad-hoc',
    },
  })
  expect(JSON.parse(readFileSync(session.paths.activeModel, 'utf8'))).toMatchObject({
    initialView: 'choices',
  })
})

it('leaves the active model unchanged after validation failure', async () => {
  const before = readFileSync(session.paths.activeModel, 'utf8')
  const failed = await compileVisualModel({
    model: invalidModel,
    command: { command: process.execPath, args: [fakeLikeC4] },
    paths: session.paths,
  })
  expect(failed.ok).toBe(false)
  expect(readFileSync(session.paths.activeModel, 'utf8')).toBe(before)
})
```

- [ ] **Step 2: Run the compiler test and confirm red**

Run: `pnpm exec vitest run test/visual-likec4-compiler.test.ts`

Expected: FAIL because the compiler adapter and fixture do not exist.

- [ ] **Step 3: Implement exact LikeC4 command execution**

Stage Task 1's already validated file map, then execute without a shell:

```ts
const validateArgs = [
  ...command.args,
  'validate',
  '--json',
  '--no-layout',
  ...sourceFiles.flatMap((file) => ['--file', file]),
  candidateRoot,
]

const exportArgs = [
  ...command.args,
  'export',
  'json',
  '--pretty',
  '-o',
  outputPath,
  candidateRoot,
]
```

Use `spawn(command.command, args, { shell: false, signal, stdio: ['ignore', 'pipe', 'pipe'] })`. Require an absolute executable path. Parse LikeC4 validation JSON into source-located `YMVS2xx` diagnostics. Parse the exported JSON as an object containing a non-empty `views` collection and the requested initial view before promotion.

The fake executable must inspect `validate` versus `export json`, emit deterministic diagnostics for a fixture marker, and copy `test/fixtures/visual/model.json` to the `-o` path on success.

- [ ] **Step 4: Run compiler/store tests and typecheck**

Run: `pnpm exec vitest run test/visual-likec4-compiler.test.ts test/visual-session-store.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the compiler adapter**

```bash
git add src/adapters/visual/likec4-compiler.ts test/visual-likec4-compiler.test.ts test/fixtures/visual/fake-likec4.mjs test/fixtures/visual/model.json
git commit -m "feat: compile temporary LikeC4 views"
```

---

### Task 4: Authenticated local session server

**Files:**
- Create: `src/adapters/visual/session-server.ts`
- Create: `test/visual-session-server.test.ts`
- Create: `test/fixtures/visual/browser-assets/index.html`
- Modify: `package.json:107-116`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Task 1 protocol parsers; Task 2 store/recovery; Task 3 compiler.
- Produces: `startVisualServer(options): Promise<VisualServerHandle>`, where the handle exposes `started`, `closed`, `status()`, and `stop(reason)`.

- [ ] **Step 1: Add `ws` and write failing authenticated transport tests**

Run: `pnpm add ws@^8.18.3 && pnpm add -D @types/ws@^8.18.1`

Test bootstrap token exchange, token-free redirect, strict cookie, host/origin rejection, authenticated WebSocket upgrade, long-poll wait, one-in-flight queueing, duplicate event rejection, queue overflow, static path traversal, and graceful stop.

```ts
it('exchanges the bootstrap token and accepts an authenticated browser socket', async () => {
  const server = await startVisualServer(fixtureOptions)
  const bootstrap = await fetch(server.started.browserUrl, { redirect: 'manual' })
  expect(bootstrap.status).toBe(303)
  expect(bootstrap.headers.get('location')).toBe('/')
  expect(bootstrap.headers.get('set-cookie')).toMatch(
    /^ym_visual=[^;]+; HttpOnly; SameSite=Strict; Path=\/$/,
  )

  const socket = new WebSocket(server.started.webSocketUrl, {
    headers: {
      Cookie: bootstrap.headers.get('set-cookie')!.split(';')[0]!,
      Origin: server.started.origin,
    },
  })
  await once(socket, 'open')
  socket.send(JSON.stringify(chatEventInput))
  await expect(waitForVisualEvent(server.started.descriptorPath, 0)).resolves.toMatchObject({
    type: 'chat.message',
    sequence: 1,
  })
})
```

- [ ] **Step 2: Run server tests and confirm red**

Run: `pnpm exec vitest run test/visual-session-server.test.ts`

Expected: FAIL because the server does not exist.

- [ ] **Step 3: Implement the HTTP/WebSocket server and queue**

Use `createServer`, `server.listen(0, '127.0.0.1')`, and `WebSocketServer({ noServer: true })`. Implement only these routes:

```text
GET  /bootstrap?key={one-time-token}
GET  / and /assets/{hashed-file}
GET  /api/session
GET  /api/agent/events?after={sequence}
POST /api/agent/responses
GET  /api/agent/status
POST /api/agent/stop
```

Browser events travel through the authenticated WebSocket. Agent routes require `Authorization: Bearer {agent capability}`. Compare capability hashes with `timingSafeEqual`. Validate `Host`, `Origin`, content type, body size, schema, session ID, and sequence before journaling.

Return these headers on every browser response:
```ts
const browserHeaders = {
  'Content-Security-Policy': `default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
} as const
```

Hold agent long-polls until the next actionable event or a 30-second non-terminal idle result. Deliver no later chat event while one response is outstanding; navigation remains local unless its payload explicitly requests agent attention.

- [ ] **Step 4: Run server, store, protocol, and type tests**

Run: `pnpm exec vitest run test/visual-session-server.test.ts test/visual-session-store.test.ts test/visual-protocol.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the local server**

```bash
git add package.json pnpm-lock.yaml src/adapters/visual/session-server.ts test/visual-session-server.test.ts test/fixtures/visual/browser-assets/index.html
git commit -m "feat: serve authenticated visual sessions"
```

---

### Task 5: Blocking `yarramate-visual` CLI

**Files:**
- Create: `src/adapters/visual/client.ts`
- Create: `src/adapters/visual-cli.ts`
- Create: `test/visual-cli.test.ts`
- Modify: `package.json:77-82`

**Interfaces:**
- Consumes: Task 4 server handle and authenticated routes; existing `versionResult`, `isMainModule`, and `CliResult` conventions.
- Produces: executable `yarramate-visual`; low-level `waitForVisualEvent`, `sendVisualResponse`, `fetchVisualStatus`, `recoverVisualSessionClient`, and `stopVisualSessionClient`; `runVisualClientCli(args, cwd)` for one-shot command formatting; `runVisualStart(requestPath, cwd, io)` for the foreground server.

- [ ] **Step 1: Write failing CLI tests**

```ts
it('prints the package version', async () => {
  await expect(runVisualClientCli(['--version'], repositoryRoot)).resolves.toMatchObject({
    exitCode: 0,
    stdout: `yarramate-visual ${packageVersion}\n`,
    stderr: '',
  })
})

it('waits, responds, recovers, and stops through the descriptor', async () => {
  const started = await startFixtureVisualProcess()
  await sendBrowserEvent(started, chatEventInput)

  const event = await runVisualClientCli(
    ['wait', started.descriptorPath, '--after', '0'],
    repositoryRoot,
  )
  expect(JSON.parse(event.stdout)).toMatchObject({ type: 'chat.message', sequence: 1 })

  await writeJson(responsePath, chatResponse)
  expect(await runVisualClientCli(
    ['respond', started.descriptorPath, responsePath],
    repositoryRoot,
  )).toMatchObject({ exitCode: 0 })

  expect(await runVisualClientCli(
    ['stop', started.descriptorPath],
    repositoryRoot,
  )).toMatchObject({ exitCode: 0 })
})
```

Also test usage exit 2, missing/unsafe descriptor, server-down `recover`, status fallback, repeated stop, and SIGTERM cleanup.

- [ ] **Step 2: Run CLI tests and confirm red**

Run: `pnpm exec vitest run test/visual-cli.test.ts`

Expected: FAIL because the CLI and client do not exist.

- [ ] **Step 3: Implement one-shot clients and foreground start**

```ts
export async function runVisualClientCli(
  args: readonly string[],
  cwd: string = process.cwd(),
): Promise<CliResult> {
  const [command, descriptor, ...rest] = args
  if (command === '--version') return versionResult('yarramate-visual')
  if (descriptor === undefined) return usageResult
  switch (command) {
    case 'wait': return waitCliCommand(descriptor, rest, cwd)
    case 'respond': return respondCliCommand(descriptor, rest, cwd)
    case 'status': return statusCliCommand(descriptor, cwd)
    case 'recover': return recoverCliCommand(descriptor, rest, cwd)
    case 'stop': return stopCliCommand(descriptor, cwd)
    default: return usageResult
  }
}
```

`runVisualStart` parses and validates the request before filesystem or network effects, starts Task 4's server in the foreground, writes exactly one `yarramate/visual-session-started/v1` JSON line, installs SIGINT/SIGTERM handlers, and awaits `handle.closed`.

The `stop` client calls recover first, POSTs the stop request, waits for the server to close, removes the marked session, and returns the recovered summary. If the server is already absent, it recovers locally and removes only a valid marked session.

- [ ] **Step 4: Run CLI tests and build the binary**

Run: `pnpm exec vitest run test/visual-cli.test.ts test/visual-session-server.test.ts && pnpm build`

Expected: PASS and `dist/adapters/visual-cli.js` exists.

Run: `node dist/adapters/visual-cli.js --version`

Expected: the prefix is `yarramate-visual` and the semver exactly matches `package.json`.

- [ ] **Step 5: Commit the sibling binary**

```bash
git add package.json src/adapters/visual/client.ts src/adapters/visual-cli.ts test/visual-cli.test.ts
git commit -m "feat: add visual session CLI"
```

---

### Task 6: Custom React and LikeC4 browser application

**Files:**
- Create: `src/visual-app/index.html`
- Create: `src/visual-app/main.tsx`
- Create: `src/visual-app/App.tsx`
- Create: `src/visual-app/session-client.tsx`
- Create: `src/visual-app/state.ts`
- Create: `src/visual-app/styles.css`
- Create: `vite.visual.config.ts`
- Create: `tsconfig.visual.json`
- Create: `test/visual-app-state.test.ts`
- Modify: `package.json:87-116`
- Modify: `pnpm-lock.yaml`
- Modify: `src/adapters/visual/session-server.ts`

**Interfaces:**
- Consumes: Task 1 event/response/status/model JSON; Task 4 `/api/session` and WebSocket; LikeC4 `createLikeC4Model`, `LikeC4ModelProvider`, and `LikeC4View`.
- Produces: prebuilt `dist/visual-app`; `visualAppReducer`; browser messages for chat, choice, navigation, and End.

- [ ] **Step 1: Add direct build dependencies and write failing reducer tests**

Run:

```bash
pnpm add -D react@^19.2.8 react-dom@^19.2.8 @types/react@^19.2.8 @types/react-dom@^19.2.3 vite@^8.1.5
```

```ts
it('freezes input immediately when End is requested', () => {
  const next = visualAppReducer(activeState, { type: 'end.requested' })
  expect(next.lifecycle).toBe('ending')
  expect(next.composerEnabled).toBe(false)
})

it('keeps the last rendered model when compilation fails', () => {
  const next = visualAppReducer(activeState, {
    type: 'diagnostic.received',
    diagnostic: compileDiagnostic,
  })
  expect(next.model).toBe(activeState.model)
  expect(next.diagnostics).toEqual([compileDiagnostic])
})
```

- [ ] **Step 2: Run reducer tests and confirm red**

Run: `pnpm exec vitest run test/visual-app-state.test.ts`

Expected: FAIL because browser state does not exist.

- [ ] **Step 3: Implement deterministic browser state and transport**

The reducer states are `connecting`, `active`, `ending`, `disconnected`, and `closed`. Keep transcript records as plain text and render them through React text nodes; never use `dangerouslySetInnerHTML`.

```ts
export function visualAppReducer(
  state: VisualAppState,
  action: VisualAppAction,
): VisualAppState {
  switch (action.type) {
    case 'session.loaded':
      return { ...state, lifecycle: 'active', ...action.snapshot }
    case 'model.received':
      return { ...state, model: action.model, diagnostics: [] }
    case 'diagnostic.received':
      return { ...state, diagnostics: [action.diagnostic] }
    case 'end.requested':
      return { ...state, lifecycle: 'ending', composerEnabled: false }
    case 'connection.lost':
      return { ...state, lifecycle: 'disconnected', composerEnabled: false }
    default:
      return state
  }
}
```

`session-client.tsx` fetches `/api/session`, opens a same-origin WebSocket, reconnects only inside the five-minute server grace, and includes the last acknowledged sequence with every browser event.

- [ ] **Step 4: Build the custom LikeC4 layout**

```tsx
const likec4model = useMemo(
  () => snapshot.model === null ? null : createLikeC4Model(snapshot.model.compiled),
  [snapshot.model],
)

return (
  <main className="visual-shell">
    <section className="diagram-pane">
      <header>
        <span className={`authority authority-${snapshot.authority}`}>
          {snapshot.authority === 'canonical' ? 'Checked YarraMate model' : 'Ad hoc · non-canonical'}
        </span>
        <h1>{snapshot.title}</h1>
        <p>{snapshot.description}</p>
      </header>
      {likec4model && (
        <LikeC4ModelProvider likec4model={likec4model}>
          <LikeC4View
            viewId={snapshot.activeView}
            onNavigateTo={(viewId) => sendNavigation(viewId)}
            enableElementDetails
            enableRelationshipDetails
            enableNotes
          />
        </LikeC4ModelProvider>
      )}
    </section>
    <ChatPanel
      transcript={snapshot.transcript}
      choices={snapshot.choices}
      disabled={!snapshot.composerEnabled}
      onSend={sendChat}
      onChoice={sendChoice}
      onEnd={endConversation}
    />
  </main>
)
```

The End button remains visible in every responsive layout. On click, dispatch `end.requested`, send `session.end`, show “Returning control to the main agent”, and wait for server closure.

- [ ] **Step 5: Add the isolated Vite build and serve its output**

`tsconfig.visual.json` uses `moduleResolution: "Bundler"`, `jsx: "react-jsx"`, `lib: ["ES2022", "DOM", "DOM.Iterable"]`, and includes only `src/visual-app/**/*.ts`, `src/visual-app/**/*.tsx`, and `vite.visual.config.ts`.

`vite.visual.config.ts` writes to `dist/visual-app`, uses `base: './'`, empties only that directory, and emits hashed JS/CSS assets. Update scripts:

```json
{
  "build:node": "tsc -p tsconfig.build.json",
  "build:visual": "vite build --config vite.visual.config.ts",
  "build": "pnpm build:node && pnpm build:visual",
  "typecheck": "tsc --noEmit && tsc -p tsconfig.visual.json"
}
```

Change the production server's default asset root to `new URL('../../visual-app/', import.meta.url)` from `dist/adapters/visual/session-server.js`; tests continue injecting the fixture asset root.

- [ ] **Step 6: Run UI state tests, typecheck, and production build**

Run: `pnpm exec vitest run test/visual-app-state.test.ts test/visual-session-server.test.ts && pnpm typecheck && pnpm build`

Expected: PASS; `dist/visual-app/index.html` and hashed local assets exist.

- [ ] **Step 7: Commit the custom browser application**

```bash
git add package.json pnpm-lock.yaml tsconfig.visual.json vite.visual.config.ts src/visual-app src/adapters/visual/session-server.ts test/visual-app-state.test.ts
git commit -m "feat: add visual conversation browser"
```

---

### Task 7: End-to-end handoff, recovery, and shutdown

**Files:**
- Create: `test/visual-journey.test.ts`
- Modify: `src/adapters/visual/session-server.ts`
- Modify: `src/adapters/visual/session-store.ts`
- Modify: `src/adapters/visual/client.ts`
- Modify: `src/adapters/visual-cli.ts`

**Interfaces:**
- Consumes: Tasks 1-6 complete runtime and browser protocol.
- Produces: identical normal-End, child-failure, browser-timeout, main-cancel, and server-down recovery paths.

- [ ] **Step 1: Write the failing complete journey**

Use the fake LikeC4 command and authenticated WebSocket client; do not invoke an LLM.

```ts
it('returns a summary, optionally exposes the transcript, and removes the session on End', async () => {
  const visual = await startVisualFixture({ chatEnabled: true })
  const browser = await connectFixtureBrowser(visual)

  browser.send(JSON.stringify(chatMessage('Explain option B')))
  const message = await waitForVisualEvent(visual.descriptorPath, 0)
  await sendVisualResponse(visual.descriptorPath, chatReply(message, 'Option B isolates rendering.'))

  browser.send(JSON.stringify(choiceSelected('option-b')))
  await sendVisualResponse(
    visual.descriptorPath,
    choiceAcknowledged(await waitForVisualEvent(visual.descriptorPath, 1)),
  )

  browser.send(JSON.stringify(sessionEnd()))
  const ending = await waitForVisualEvent(visual.descriptorPath, 2)
  await sendVisualResponse(visual.descriptorPath, completeHandoff(ending, {
    summary: 'Selected option B.',
    confirmedDecisions: ['option-b'],
    requestedChanges: [],
    unresolvedQuestions: [],
    finalViews: ['choices', 'option-b'],
  }))

  expect(await recoverVisualSessionClient(
    visual.descriptorPath,
    { includeTranscript: false },
  )).toMatchObject({
    summary: 'Selected option B.',
    transcript: undefined,
  })
  expect(await recoverVisualSessionClient(
    visual.descriptorPath,
    { includeTranscript: true },
  )).toMatchObject({
    transcript: expect.any(Array),
  })

  await stopVisualSessionClient(visual.descriptorPath)
  expect(existsSync(visual.sessionRoot)).toBe(false)
  await expect(fetch(visual.origin)).rejects.toThrow()
})
```

- [ ] **Step 2: Add failing recovery matrix tests**

Cover:

- child disconnect before `handoff.complete` derives a partial summary with `terminationReason: 'child-failed'`;
- five-minute browser grace expiry creates a terminal event and freezes chat;
- direct main cancellation aborts an active compiler process;
- runtime restart recovers from journal without acknowledging a truncated record;
- repeated `stop` reports `alreadyStopped: true`;
- two sessions reject each other's browser cookies, agent descriptors, event IDs, and response IDs;
- diagram-only mode rejects chat writes while preserving navigation.

- [ ] **Step 3: Run the journey test and confirm red**

Run: `pnpm exec vitest run test/visual-journey.test.ts`

Expected: FAIL at the first missing shared recovery transition.

- [ ] **Step 4: Centralize terminal transition and recovery**

Add one function called by End, failures, timeout, and cancellation:

```ts
export async function terminateVisualSession(
  session: ActiveVisualSession,
  reason: VisualTerminationReason,
): Promise<VisualHandoff> {
  if (session.lifecycle === 'stopped') return session.handoff
  session.lifecycle = 'recovering'
  session.acceptBrowserInput = false
  session.compilerAbort.abort()
  await appendTerminalEvent(session.paths, reason)
  const handoff = await recoverVisualSession(session.paths, false)
  session.handoff = handoff
  return handoff
}
```

Make `stop` call `terminateVisualSession` before closing sockets/server and removing the marked root. Preserve the transcript until `stop`; `recover --transcript` reads it without changing lifecycle.

- [ ] **Step 5: Run all visual tests and typecheck**

Run: `pnpm exec vitest run test/visual-*.test.ts && pnpm typecheck && pnpm build`

Expected: PASS.

- [ ] **Step 6: Commit the complete lifecycle**

```bash
git add src/adapters/visual src/adapters/visual-cli.ts test/visual-journey.test.ts
git commit -m "feat: recover visual conversations"
```

---

### Task 8: Skill orchestration, consumer guidance, and packed package

**Files:**
- Create: `skills/yarramate-architecture/references/visual-conversations.md`
- Modify: `skills/yarramate-architecture/SKILL.md:15-260`
- Modify: `docs/CONSUMING-YARRAMATE.md:60-170`
- Modify: `test/package-consumer.test.ts:20-100,136-153`
- Modify: `package.json:24-82`

**Interfaces:**
- Consumes: `yarramate-visual` protocol and capability rules from Tasks 1-7.
- Produces: canonical natural-language journey and packed binary/assets/schemas.

- [ ] **Step 1: Write failing package and skill contract assertions**

```ts
expect(packageJson.bin['yarramate-visual']).toBe('dist/adapters/visual-cli.js')
expect(packageJson.files).toContain('dist')
expect(files).toContain('package/dist/adapters/visual-cli.js')
expect(files).toContain('package/dist/visual-app/index.html')
expect(files).toContain('package/schema/yarramate-visual-event.schema.json')
expect(files).toContain(
  'package/skills/yarramate-architecture/references/visual-conversations.md',
)
expect(consumerGuide).toContain('visually explain')
expect(consumerGuide).toContain('diagram-only mode')
```

In the packed consumer setup, add the `yarramate-visual` symlink and assert `--version` matches the package version.

- [ ] **Step 2: Run package tests and confirm red**

Run: `pnpm exec vitest run test/package-consumer.test.ts`

Expected: FAIL because the package and skill do not expose visual conversations yet.

- [ ] **Step 3: Add the visual request branch to the canonical skill**

Add a concise section to `SKILL.md` that triggers on visual explanation/show/compare requests and loads the new reference. Keep the full loop in the reference:

```text
request
  -> classify canonical or ad hoc authority
  -> for repository architecture: yarramate check, then yarramate ask --json
  -> resolve LikeC4 >=1.59.2 <1.60.0; ask before pinned runner
  -> inspect actual harness delegation/recovery capabilities
  -> start yarramate-visual as a managed foreground process
  -> capable: delegate bounded visual agent and await handoff
  -> incapable: diagram-only mode; continue conversation in main harness
  -> End/failure: recover, optionally read transcript, stop, resume main
```

The child prompt in `visual-conversations.md` must state:

```text
You are the delegated YarraMate visual agent for one session.
You may call read-only YarraMate commands and yarramate-visual wait/respond/status/recover.
You may replace only the temporary yarramate/visual-model/v1 session model.
You must not edit repository files, .yarramate/, credentials, or harness configuration.
On session.end or any terminal diagnostic, publish handoff.complete and exit.
```

Document `start` through the harness's long-running process tool. Never recommend shell daemonization. Capability-detect from tools/lifecycle guarantees, not harness names.

- [ ] **Step 4: Update consumer guidance and package exports**

Document authority labels, the local-only server, consented pinned runner, chat-capable journey, diagram-only fallback, main-agent recovery, transcript-on-demand, and server cleanup. Add all nine schema exports and the binary. The prepack build already runs both Node and visual builds from Task 6.

- [ ] **Step 5: Run skill/package tests and pack smoke**

Run: `pnpm exec vitest run test/package-consumer.test.ts && pnpm build && npm pack --dry-run`

Expected: PASS; dry-run lists `dist/adapters/visual-cli.js`, `dist/visual-app/index.html`, nine visual schemas, and the visual-conversation reference.

- [ ] **Step 6: Commit the consumer journey**

```bash
git add package.json skills/yarramate-architecture docs/CONSUMING-YARRAMATE.md test/package-consumer.test.ts
git commit -m "docs: guide visual architecture conversations"
```

---

### Task 9: Declare and verify the YarraMate self-model

**Files:**
- Create: `.yarramate/projections/visual-conversation-path.yaml`
- Modify: `.yarramate/architecture/engine.yaml`
- Modify: `.yarramate/architecture/repository.yaml`
- Modify: `.yarramate/evidence/repository.yaml`
- Modify: `.yarramate/likec4-project.yaml`
- Modify: `.yarramate/integrations/likec4/subject-mapping.yaml`
- Modify: `test/self-model.test.ts`

**Interfaces:**
- Consumes: shipped files and responsibilities from Tasks 1-8.
- Produces: checked current-state declarations, evidence, bounded projection, and rendered LikeC4 coverage for the visual-conversation path.

- [ ] **Step 1: Write failing self-model assertions**

```ts
it('models the recoverable visual conversation path', () => {
  const result = compileWorkspace(selfModelSources)
  expect(result.ok).toBe(true)
  if (!result.ok) return

  expect(result.graph.concepts).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'yarramate-engine#visual-runtime' }),
    expect.objectContaining({ id: 'yarramate-engine#visual-session-service' }),
    expect.objectContaining({ id: 'yarramate-engine#visual-browser' }),
    expect.objectContaining({ id: 'yarramate-engine#visual-session-protocol' }),
    expect.objectContaining({ id: 'yarramate-engine#visual-handoff' }),
  ]))

  const projection = loadProjection(repositorySource(
    '.yarramate/projections/visual-conversation-path.yaml',
  ))
  expect(projection.ok).toBe(true)
  if (!projection.ok) return
  const rendered = evaluateProjection(result.graph, projection.projection)
  expect(rendered.concepts.map(({ id }) => id)).toContain(
    'yarramate-engine#visual-runtime',
  )
})
```

- [ ] **Step 2: Run self-model tests and confirm red**

Run: `pnpm exec vitest run test/self-model.test.ts`

Expected: FAIL because the visual subjects and projection are absent.

- [ ] **Step 3: Add the smallest coherent current-state model**

Declare these owned/current subjects in `engine.yaml`:

```yaml
  - id: visual-runtime
    kind: applicationComponent
    name: Visual conversation runtime
    description: Serves authenticated temporary LikeC4 explanations, browser chat transport, recovery, and cleanup without invoking a model provider.
    owner: yarramate-product#yarramate-maintainers
    status: current
  - id: visual-browser
    kind: applicationComponent
    name: Visual conversation browser
    description: Custom React and LikeC4 presentation for diagrams, descriptions, choices, chat, status, and End.
    owner: yarramate-product#yarramate-maintainers
    status: current
  - id: visual-session-service
    kind: applicationService
    name: Visual session command
    description: Starts, waits on, responds to, inspects, recovers, and stops one local visual conversation.
    owner: yarramate-product#yarramate-maintainers
    status: current
  - id: visual-session-protocol
    kind: dataObject
    name: Visual session protocol
    description: Versioned browser, delegated-agent, model, status, and handoff documents for one temporary session.
    owner: yarramate-product#yarramate-maintainers
    status: current
  - id: visual-handoff
    kind: dataObject
    name: Visual conversation handoff
    description: Recoverable summary of confirmed decisions, requested changes, unresolved questions, final views, termination, and optional transcript access.
    owner: yarramate-product#yarramate-maintainers
    status: current
  - id: render-visual-model
    kind: applicationFunction
    name: Render temporary visual model
    description: Validates, compiles, and atomically promotes a complete grounded or explicitly ad hoc LikeC4 model.
    status: current
  - id: recover-visual-session
    kind: applicationFunction
    name: Recover visual conversation
    description: Derives the main-agent handoff from the append-only journal before shutdown or after failure.
    status: current
```

Add assignment, serving, and access relationships using existing profile kinds:

```yaml
  - id: visual-runtime-renders-model
    kind: assignment
    from: visual-runtime
    to: render-visual-model
  - id: visual-runtime-recovers-session
    kind: assignment
    from: visual-runtime
    to: recover-visual-session
  - id: visual-session-serves-agent-harness
    kind: serving
    from: visual-session-service
    to: yarramate-product#agent-harness
  - id: visual-rendering-reads-protocol
    kind: access
    from: render-visual-model
    to: visual-session-protocol
    mode: read
  - id: visual-recovery-writes-handoff
    kind: access
    from: recover-visual-session
    to: visual-handoff
    mode: write
```

Add repository-file, schema, test, browser-asset, and skill-reference subjects in `repository.yaml`; link each stable subject to its real file through realization/association relationships. Add confirmed repository evidence only after the corresponding file exists.

- [ ] **Step 4: Add the focused projection and LikeC4 project view**

Create `visual-conversation-path.yaml` containing the engine subjects above, `yarramate-product#agent-harness`, `yarramate-repository#agent-skill-source`, visual runtime sources/tests/schemas, and `relationships: between`. Use title `Visual architecture conversation` and describe the delegated and diagram-only paths.

Add the projection under the agent-contract story in `.yarramate/likec4-project.yaml`.

- [ ] **Step 5: Observe mapping drift, synchronize, and verify the authored model**

Run the read-only checks first:

```bash
yarramate check .yarramate/workspace.yaml --json
yarramate-likec4 check .yarramate/likec4-project.yaml --json .yarramate/workspace.yaml
```

Expected: Core check passes; LikeC4 check reports only new intended unmapped subjects.

Then repair and verify:

```bash
yarramate-likec4 map --sync .yarramate/integrations/likec4/subject-mapping.yaml .yarramate/workspace.yaml
yarramate check .yarramate/workspace.yaml --json
yarramate reconcile .yarramate/workspace.yaml
yarramate ask .yarramate/workspace.yaml .yarramate/projections/visual-conversation-path.yaml
yarramate-likec4 check .yarramate/likec4-project.yaml --json .yarramate/workspace.yaml
yarramate-likec4 export-project .yarramate/likec4-project.yaml .yarramate-out/likec4 .yarramate/workspace.yaml
likec4 validate --json --no-layout --file .yarramate-out/likec4/model.likec4 --file .yarramate-out/likec4/specification.likec4 .yarramate-out/likec4
```

Expected: both read-only checks succeed after sync; reconciliation has no findings; the focused slice names the visual runtime/agent/browser/handoff path; LikeC4 validation reports `filteredErrors: 0`.

- [ ] **Step 6: Run self-model and visual tests**

Run: `pnpm exec vitest run test/self-model.test.ts test/visual-*.test.ts && pnpm typecheck && pnpm build`

Expected: PASS.

- [ ] **Step 7: Commit the declared architecture**

```bash
git add .yarramate test/self-model.test.ts
git commit -m "arch: declare visual conversation runtime"
```

---

### Task 10: Real browser smoke and full verification

**Files:**
- None expected; confirmed defects return to the task that owns the failing contract.

**Interfaces:**
- Consumes: complete packed runtime, custom renderer, fake visual agent protocol, canonical skill, and checked self-model.
- Produces: observed end-to-end evidence for the accepted user experience.

- [ ] **Step 1: Build and create a temporary ad hoc smoke request**

Run: `pnpm build`

Run `node -p process.execPath` and use the printed absolute executable path in `/tmp/yarramate-visual-smoke/request.json`. The request uses format `yarramate/visual-session-request/v1`, `authority: "ad-hoc"`, `chatEnabled: true`, that compiler command plus the absolute `test/fixtures/visual/fake-likec4.mjs`, and a complete model containing a comparison overview linked to two detail views.

- [ ] **Step 2: Start the real foreground server through the harness process manager**

Run as a managed long-running process, not a shell background job:

```bash
node dist/adapters/visual-cli.js start /tmp/yarramate-visual-smoke/request.json
```

Expected first line: valid `yarramate/visual-session-started/v1` JSON with a secret localhost URL and descriptor path. Copy that line verbatim to `/tmp/yarramate-visual-smoke/started.json` with the file-writing tool, then keep the managed process running.

- [ ] **Step 3: Drive the custom browser UI**

Open the complete authenticated URL in the browser. Verify visually:

- custom split diagram/chat layout loads without external requests;
- authority label reads `Ad hoc · non-canonical`;
- overview renders and navigates to both detail views;
- description and connection state are visible;
- chat composer, structured choices, and End remain usable at desktop and narrow viewport widths;
- hostile `<img src=x onerror=alert(1)>` content renders as text and produces no dialog/console execution.

- [ ] **Step 4: Exercise one browser-only delegated turn**

Send `Explain the second option` in the browser. In a separate agent/terminal action:

```bash
DESCRIPTOR="$(node -p 'JSON.parse(require(\"node:fs\").readFileSync(\"/tmp/yarramate-visual-smoke/started.json\",\"utf8\")).descriptorPath')"
node dist/adapters/visual-cli.js wait "$DESCRIPTOR" --after 0
node dist/adapters/visual-cli.js respond "$DESCRIPTOR" /tmp/yarramate-visual-smoke/chat-response.json
node dist/adapters/visual-cli.js respond "$DESCRIPTOR" /tmp/yarramate-visual-smoke/model-response.json
```

Create both response files with the session ID and triggering event ID printed by `wait`: `chat-response.json` contains `chat.response`; `model-response.json` contains a valid `model.replace` showing the selected option's detail. Give them distinct response IDs. Verify the browser receives both without a terminal user message.

- [ ] **Step 5: Exercise End and main-agent recovery**

Click End. Process the returned `session.end` with `handoff.complete`, then run:

```bash
DESCRIPTOR="$(node -p 'JSON.parse(require(\"node:fs\").readFileSync(\"/tmp/yarramate-visual-smoke/started.json\",\"utf8\")).descriptorPath')"
node dist/adapters/visual-cli.js recover "$DESCRIPTOR"
node dist/adapters/visual-cli.js recover "$DESCRIPTOR" --transcript
node dist/adapters/visual-cli.js stop "$DESCRIPTOR"
```

Expected: first recovery contains the summary and transcript handle only; second contains the raw transcript; stop returns success, the managed server exits, the browser loses the local session, and the marked temporary directory no longer exists.

- [ ] **Step 6: Run the complete repository verification**

```bash
pnpm verify
pnpm exec vitest run test/package-consumer.test.ts test/self-model.test.ts test/visual-*.test.ts
yarramate check .yarramate/workspace.yaml --json
yarramate reconcile .yarramate/workspace.yaml
yarramate-likec4 check .yarramate/likec4-project.yaml --json .yarramate/workspace.yaml
```

Expected: every command exits 0; Core and LikeC4 checks are valid; reconciliation has zero findings.

- [ ] **Step 7: Confirm the smoke introduced no unreviewed changes**

Run:

```bash
git status --short
```

Expected: no tracked changes. If the smoke exposed a defect, return to the task that owns that contract, add a failing automated test there, implement the fix, rerun Steps 1-6, and commit with that owning task's file list.
