# Sources come from a store, and a batch lands by compare-and-swap

Status: accepted

Core reads and writes the filesystem directly. `applyOperations` calls
`readFileSync` in four places and ends in a loop of `writeFileSync`;
`loadWorkspaceManifest` resolves a manifest's globs with `globSync`, `statSync`
and `realpathSync`. Everything else about the engine is already a pure
function of its input: `compileWorkspace(sources)` takes `{path, source}[]` and
`src/compiler.ts` imports nothing from `node:fs` at all.

This ADR moves the remaining filesystem calls behind a `SourceStore` that lives
outside Core, leaves Core a pure function from sources to sources, and makes a
batch land by comparing each document against the revision its author read.
One mechanism then answers three questions that are currently answered in three
places, or not at all.

## Why

**Embedding is blocked on it.** `aperture-x` keeps its model in D1 and
`yarramate` cannot be asked to compile it, because reaching a document means
reaching a disk. The Worker-safety argument already made for
`src/shipped-profile.ts` and the vendored relationship table applies to the
write path too, and only the write path fails it.

**The staleness pin is enforced a layer too high, with a real gap.**
[ADR 0093](0093-a-commit-states-what-it-was-staged-against.md) made the visual
runtime pin a digest per document and refuse a batch whose pin no longer
matches. It works, but it is a check in the adapter followed by an
unconditional write in Core:

```ts
// session-server.ts: read every targeted document and compare its digest
held = digestOf(readFileSync(resolve(options.cwd, path), "utf8"))
...
// then, separately, Core reads those same files again and writes them
const outcome = applyOperations(operations, manifestSource, options.cwd)
```

Between the digest that satisfied the precondition and the write that acts on
it, Core re-reads every source and compiles a whole workspace. On this
repository that is a 267-concept, 375-relationship compile. Any write landing
in that window is overwritten by a batch that already proved it was current.
The window is not a theoretical one: it is the most expensive operation in the
command, sitting squarely between the check and the write.

**Every other writer has no precondition at all.** `yarramate apply` from a
terminal, an agent loop, and CI all write unconditionally. Only the browser
pins anything, and it is the one client that already had the information.

**The atomic batch is a Core promise that Core cannot keep.**
[ADR 0057](0057-writes-land-as-one-validated-batch.md) says a batch is atomic:
staged in memory, compiled whole, rejected whole. That is true up to the last
loop, which writes N files one at a time with no way to undo the first if the
third fails.

## Decided

**A `SourceStore` owns every read and write of a workspace's sources, and Core
never touches one.**

```ts
interface SourceStore {
  // The paths this store holds, for a manifest's globs to match against.
  list(): readonly string[]
  // The bytes, and an opaque statement of which bytes they are.
  read(path: string): { source: string; revision: string } | undefined
  // All of them or none, each only if it still holds what was read.
  writeAll(writes: readonly PendingWrite[]): WriteOutcome
}

interface PendingWrite {
  readonly path: string
  readonly source: string
  // The revision this edit was made against, or null for "must not exist yet".
  readonly expected: string | null
}
```

**A revision is opaque to everything but the store that minted it.** A
filesystem store may use a content hash, S3 an ETag, git a blob sha, D1 a
rowversion. Core never parses one, never orders two, and never asks what it
means. The only operation is equality, performed by the store that issued it.

**Core becomes a pure function from sources to sources.**

```ts
applyOperations(
  sources: readonly WorkspaceSource[],
  operations: WorkspaceSource,
): { ok: true; sources: readonly WorkspaceSource[]; result: ApplyResult }
 | { ok: false; diagnostics: readonly Diagnostic[] }
```

It returns the documents it changed and does not write them. The caller pairs
each with the revision it read and hands the batch to `writeAll`. This is what
makes the check-to-write window collapse: the compile happens before
`writeAll`, so the store's own comparison is the last thing that happens before
the bytes land, rather than the first thing that happened several hundred
milliseconds earlier.

**Manifest resolution splits in two.** Matching a manifest's globs against a
set of paths is arithmetic and stays in Core. Producing that set is the store's
`list`. `YM701` (a pattern that escapes the manifest directory) stays a Core
rule about the shape of a pattern. Containment against symlinks becomes the
store's responsibility, because `realpathSync` is a filesystem concept that a
D1 store has no analogue for and must not be asked to fake.

**Two diagnostics, in the workspace range.** `YM704`: a document changed after
this edit was staged, naming the document. `YM705`: a document expected not to
exist already does. `YMVS312` and `YMVS313` remain the visual runtime's wire
codes and are derived from these rather than computed independently, so the
browser's preserve-and-refresh behaviour is unchanged while the rule behind it
moves down a layer.

## Consequences

**What each store can honestly claim.** The guarantee is the store's, not
Core's, and it differs:

| store | `writeAll` is | on partial failure |
| --- | --- | --- |
| D1, Postgres | one transaction | nothing lands |
| S3 | per-object conditional put | earlier objects land |
| filesystem | compare-then-rename per file | earlier files land |

The filesystem store checks every revision, then writes every file, with no
compile in between. That is a narrow window rather than no window, and this
ADR does not pretend otherwise: a genuinely atomic multi-file commit on a plain
filesystem needs a lock or a journal, which is a separate decision with its own
costs. What is claimed is bounded and testable: a batch never lands against
bytes other than the ones its author read, and the interval in which that could
stop being true no longer contains a compile.

**The CLI stays synchronous.** `runCli` has no `await` anywhere, and a store
interface that returned promises would make every command and every test async
to serve stores that do not ship. The shipped filesystem store is synchronous.
An embedder whose backing store is asynchronous fetches its sources, calls the
pure functions, and writes the results back, which is the shape D1 and S3
callers want regardless.

**Blast radius is small because the hard part is done.** `compileWorkspace` is
already pure. Seven files in `src/` reach for `applyOperations` or
`loadWorkspaceManifest`, and the write surface is a single loop. The change is
mostly moving reads to a seam that already almost exists.

**`apply` gains a refusal it did not have.** A terminal `apply` whose documents
moved under it is now refused rather than silently landing. That is a new way
for a previously-succeeding command to fail, and it is the point.

## Rejected

**An asynchronous store interface.** Correct for D1 and S3, and viral: every
command, adapter and test becomes async to accommodate stores that are not
shipped. Rejected in favour of a synchronous interface plus pure Core
functions, which serves the same embedders without the rewrite. If a store
that must be async and must be driven by Core ever appears, this is the
decision to revisit.

**A version counter per document.** Rejected for the reason ADR 0093 already
gave: optimistic concurrency is a precondition checked at write time, and the
bytes' own revision is already a perfectly good version. A counter is a second
thing to maintain and no better.

**Per-field preconditions.** Rejected as a first move for the reason ADR 0093
gave, unchanged here. Per-document is coarser, costs nothing extra, and
narrowing it later turns a refusal into an acceptance, which is the safe
direction to move.

**Keeping the pin in the adapter and closing the window with a lock.** A lock
held across the compile would work and would keep Core as it is, but it
serialises every writer to make one of them safe, and it does nothing for
embedding, which is the other half of what this seam is for.
