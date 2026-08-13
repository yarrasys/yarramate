# Visual Descriptor and Chat Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent visual client commands from blocking on FIFO descriptors and make embedded-chat capability require a real delegated visual LLM agent.

**Architecture:** Keep the published visual protocol unchanged. Harden the private descriptor's existing open-then-`stat` boundary with non-blocking filesystem flags, and tighten the canonical harness journey so a transport-only responder cannot be presented as embedded chat.

**Tech Stack:** Node.js 22, TypeScript, Vitest, POSIX `mkfifo`, YarraMate visual session protocol, Markdown skill instructions.

## Global Constraints

- No schema, protocol, browser UI, session lifecycle, or authority change.
- The runtime remains model-provider-neutral.
- Diagram-only fallback remains mandatory when the harness cannot attach and supervise a delegated visual LLM agent.
- Repeated-stop semantics, generic symlink diagnostics, and the existing `O_NOFOLLOW` portability tradeoff remain unchanged.
- FIFO descriptors must fail closed with `YMVS401` and must not expose the agent capability.

---

### Task 1: Make descriptor opening non-blocking

**Files:**
- Modify: `src/adapters/visual/client.ts:149-176`
- Test: `test/visual-cli.test.ts:1-120,448-480`

**Interfaces:**
- Consumes: `readVisualSessionDescriptor(path: string, cwd?: string): Promise<ParseResult<VisualSessionDescriptor>>`
- Produces: unchanged descriptor parsing API; hostile FIFO entries return the existing `YMVS401` refusal promptly.

- [ ] **Step 1: Write the failing FIFO subprocess test**

Add `execFileSync` and `spawnSync` from `node:child_process`, define the repository root from `import.meta.url`, and add this POSIX-only case under `descriptor confinement`:

```ts
it.runIf(process.platform !== 'win32')(
  'refuses a FIFO descriptor without waiting for a writer',
  async () => {
    const fifo = join(workDir, 'descriptor.fifo')
    execFileSync('mkfifo', [fifo])

    const result = spawnSync(
      process.execPath,
      ['dist/adapters/visual-cli.js', 'status', fifo],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        timeout: 1000,
      },
    )

    expect(result.signal).toBeNull()
    expect(result.status).toBe(1)
    expect(
      parseVisualDiagnosticResult(JSON.parse(result.stderr)),
    ).toMatchObject({
      ok: true,
      value: { diagnostics: [{ code: 'YMVS401' }] },
    })
  },
)
```

Use:

```ts
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
```

The child-process timeout is part of the assertion: the pre-fix implementation is killed instead of hanging the Vitest worker.

- [ ] **Step 2: Build the current implementation and prove the regression is red**

Run:

```sh
pnpm build:node
pnpm exec vitest run test/visual-cli.test.ts -t "refuses a FIFO descriptor"
```

Expected: FAIL because `spawnSync` reports `SIGTERM`/timeout rather than an exit-1 `YMVS401` diagnostic.

- [ ] **Step 3: Add the minimal descriptor-open flag**

Change the descriptor open flags to:

```ts
constants.O_RDONLY |
  constants.O_NONBLOCK |
  (constants.O_NOFOLLOW ?? 0)
```

Keep the single opened handle, `handle.stat()`, regular-file check, `handle.readFile('utf8')`, diagnostics, and close behavior unchanged.

- [ ] **Step 4: Rebuild and prove the regression is green**

Run:

```sh
pnpm build:node
pnpm exec vitest run test/visual-cli.test.ts -t "descriptor confinement"
```

Expected: all descriptor-confinement tests pass; the FIFO child exits 1 with `YMVS401` before the 1000 ms timeout.

- [ ] **Step 5: Commit the security hardening**

```sh
git add src/adapters/visual/client.ts test/visual-cli.test.ts
git commit -m "fix: reject visual descriptor FIFOs without blocking"
```

---

### Task 2: Tighten embedded-chat capability instructions

**Files:**
- Modify: `skills/yarramate-architecture/references/visual-conversations.md:68-82,154-188`

**Interfaces:**
- Consumes: the existing four-part harness capability gate and delegated-agent `wait`/`respond` loop.
- Produces: an explicit orchestration invariant: `chatEnabled: true` means a real delegated visual LLM child will be attached; canned, scripted, and transport-only responders do not qualify.

- [ ] **Step 1: Add the capability guard**

Immediately after the four capability requirements, add:

```markdown
`chatEnabled: true` also means the parent will attach the delegated visual LLM
agent described below. A canned, scripted, or transport-only responder may test
the wire, but it does not satisfy this capability gate and must not be presented
to the user as embedded chat. If no delegated LLM child will own the
`wait`/`respond` loop, use diagram-only mode.
```

Under **Delegate the visual agent**, add one sentence before the child prompt:

```markdown
Do not replace this child with a fixed-response script: the protocol is
model-provider-neutral, but the embedded conversation still requires the
harness's delegated LLM.
```

- [ ] **Step 2: Check packaging still carries the canonical skill**

Run:

```sh
pnpm build
pnpm exec vitest run test/package-consumer.test.ts
```

Expected: package-consumer tests pass and the packed `yarramate/skill/yarramate-architecture` export resolves to the skill containing `references/visual-conversations.md`.

- [ ] **Step 3: Commit the orchestration guard**

```sh
git add skills/yarramate-architecture/references/visual-conversations.md
git commit -m "docs: require a delegated LLM for visual chat"
```

---

### Task 3: Exercise the corrected journey and verify the PR

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: `yarramate-visual start/wait/respond/recover/stop`, a managed foreground process, and a real delegated visual LLM child.
- Produces: browser-visible evidence that an arbitrary in-scope question reaches the delegated LLM, plus complete repository verification.

- [ ] **Step 1: Start a canonical chat-enabled visual session**

Use `.yarramate-out/visual-runtime-request.json`, launch `yarramate-visual start` through the harness's managed-process facility, and capture the emitted `browserUrl` and `descriptorPath`. Do not attach a scripted responder.

- [ ] **Step 2: Attach the delegated visual LLM child**

Delegate one child with the exact authority prompt from `skills/yarramate-architecture/references/visual-conversations.md`, the emitted descriptor path, and the checked `visual-conversation-path` slice. The child must loop on `wait`, generate answers from the bounded slice, and publish them with `respond`.

- [ ] **Step 3: Exercise browser chat and End**

Open `browserUrl`, send `What happens after I press End?`, and confirm the browser receives a generated answer explaining the handoff lifecycle rather than the former canned LikeC4 prompt. Press End, observe the preparing/handoff-ready/closed status progression, recover the structured handoff, and stop the managed process.

- [ ] **Step 4: Run complete verification**

Run:

```sh
pnpm verify
```

Expected: typecheck, build, all tests, self-check, and LikeC4 validation pass. The existing Vite chunk-size warning is non-failing and unchanged.
