# A write can remove, and a view lands in the same batch as the model

Status: accepted

[ADR 0100](0100-sources-come-from-a-store-and-a-batch-lands-by-compare-and-swap.md)
gave a workspace a `SourceStore` whose `writeAll` lands a batch by
compare-and-swap. It can create a document and it can replace one. It cannot
remove one, and nothing else in the engine can either.

That was not noticed because nothing needed it. The visual editor now does:
[#246](https://github.com/yarrasys/yarramate/issues/246) asks for delete on a
view, and states the constraint that makes it more than a menu item — creating
and deleting a view writes and removes a projection document, so **both are
staged and committed like any other change rather than landing immediately.**

## Why

**A projection is written outside every guarantee the engine has.** The visual
runtime's `view.save` composes a projection, validates it, and writes it with
`writeFileSync` the moment the reviewer presses Save. It is outside the
changeset, so it cannot be undone. It is outside ADR 0093's staleness pin, so
it overwrites a projection someone else edited without noticing. And it is
outside the batch, so a view and the subjects it shows cannot land together.

**Three separate features are blocked on the same missing thing.** #246 needs
create and delete staged. [#248](https://github.com/yarrasys/yarramate/issues/248)
needs a query edit staged. [#255](https://github.com/yarrasys/yarramate/issues/255)
needs view membership staged. Each was filed as a UI change; each is the same
absent mechanism wearing a different costume.

**A rename is a create and a remove, and half of it is impossible.** A
projection's id decides its path, so renaming a view writes one document and
must remove another. With no removal, rename cannot be expressed at all — not
staged, and not even immediately.

## Decided

### A pending write with no bytes removes the document

```ts
interface PendingWrite {
  readonly path: string
  // The bytes to leave behind, or null to remove the document.
  readonly source: string | null
  // The revision this edit was made against, or null for "must not exist yet".
  readonly expected: string | null
}
```

Removal is a write like any other. It lands in the same all-or-none batch,
under the same compare-and-swap, so a view deleted beside a subject edit takes
both or neither.

**A removal must name a revision.** `expected: null` on a removal asks to
remove a document on condition it is not there, which is not a thing to want.
It is refused as `exists` rather than treated as a no-op, because a caller told
its accidental delete worked is worse served than one told it made no sense.

**An emptied directory is left behind.** A workspace cannot tell a directory it
emptied from one it never had, and removing it would be the store inventing an
intention the caller never stated.

### A view operation is the adapter's, not Core's

Core keeps its invariant. `applyOperations` says, and continues to say, that
*projections and adapter mappings are never an operation's own target — they
are only ever carried along by a rename.* `yarramate/operations/v1` is
unchanged, and the Core contract with it.

A projection change instead rides beside the model's operations on the visual
adapter's own commit:

```ts
type VisualViewOperation =
  | { op: 'write-view';  path: string; projection: ProjectionDefinition }
  | { op: 'delete-view'; path: string }

interface VisualChangesetCommitPayload {
  operations:     readonly YarramateOperation[]    // the model
  viewOperations: readonly VisualViewOperation[]   // the views
  sourceDigests:  Readonly<Record<string, string>> // what both expected on disk
}
```

**Atomicity comes from one `writeAll`, not from one list.** The adapter plans
the model's writes, composes the views' writes, and hands the store a single
batch. A view and the subjects it shows land together or not at all, which is
the property that actually matters — and it is bought without making a
presentation artifact into a semantic operation.

To make that possible, `landOperations` splits: `planOperations` returns the
writes a batch would make, and `landOperations` stays `planOperations` followed
by `writeAll`. The CLI is untouched.

### A projection written where nothing loads it is refused

A manifest's patterns decide which files are the workspace.
[ADR 0043](0043-projections-are-scaffolded-through-validated-writes.md) already
names this trap for `new projection`, which reminds an author to include a file
no glob covers. The editor cannot rely on a reminder — nobody is reading
stdout — so a `write-view` whose path no pattern matches is refused before
anything is written. This repository's own manifest uses `projections/*.yaml`,
which reaches no subdirectory, so the first view saved into a folder would
otherwise be a file the workspace silently never loads.

## Consequences

**`view.save` is retired.** The event, its result frame, and the browser state
that tracked it all go. Saving a view becomes a row in the tray that can be
read, discarded and undone, and the confirm-before-overwrite dialog becomes
unnecessary because the overwrite is visible before it lands.

**The visual protocol goes to `v5`.** The commit payload gains a required list
and the model frame gains the projection digests a view operation pins against.
Both are breaking, and both are free while the 1.0.0 tag is still unmade.

**Projection digests are published separately from source digests.**
`VisualRenderedModel.sourceDigests` means *what this graph was compiled from*,
which `YMVS112` checks and a projection is not part of. A second map says what
the views are. On the commit payload one map still covers both, because there
the meaning is uniform: what the browser expected to find on disk.

**Every store must now say what removal means for it.** The filesystem store
unlinks. A D1 store deletes a row inside the same transaction and gets a
stronger guarantee than the filesystem one; an S3 store deletes an object and
gets a weaker one. That spread is the same one ADR 0100 already tabulated for
writes, and this ADR does not narrow it.

**A batch can now shrink a workspace.** `yarramate apply` cannot yet ask for
that — no Core operation removes a document — so the reach is limited to the
visual adapter today. If a Core-level document removal is ever wanted, this
store surface is already what it would land on.

## Rejected

**Extending `YarramateOperation` with projection operations.** One mechanism
instead of two, and it would give `yarramate apply` view editing for free.
Rejected because it reverses a stated Core invariant in order to make a
presentation artifact a semantic target, changes a contract registered in the
Core contract, and buys an atomicity that a single `writeAll` already provides.
If view editing from a terminal is ever wanted, this is the decision to
revisit — and the store surface it needs is the one this ADR adds.

**A separate `deleteAll` on the store.** Honest about the two operations being
different, and fatal to the only property worth having: two calls are two
batches, so a view removed in one and a subject edited in the other can half
land. Rejected for the same reason ADR 0057 gives for staging a batch whole.

**Keeping immediate writes and adding an undo stack for views.** Smaller, and
it keeps `view.save`. Rejected because undo over a write that already happened
is a second write, which is exactly the unconditional overwrite ADR 0093 exists
to refuse — and because it leaves a view and the model landing at different
times, which is the thing #246 asked not to have.

**Letting a `write-view` create the manifest pattern it needs.** It would make
folders work with no refusal. Rejected on ADR 0043's reasoning: the workspace
manifest is the author's statement of what the workspace is, and a tool that
edits it to make its own write valid has removed the author from the decision.
