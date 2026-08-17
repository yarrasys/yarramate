# Undo restores a snapshot, not an inverse operation

Status: accepted

The visual runtime stages mechanical edits locally and lands them as one batch
through `yarramate apply` (ADR 0084). A reviewer could stage an operation and
discard one row by index, or discard all of them, but could not walk back an
edit they had already replaced. Ordered in-app undo and redo over the staged
changeset was the last locally actionable item in the agreed scope.

## Why an inverse operation cannot be the unit

The obvious shape — record an inverse for each staged operation and apply it
on undo — cannot work here, because staging is not append-only.
`changeset.staged` replaces any operation sharing the same
`changesetTargetKey`, so re-editing one field twice leaves a single row
holding the newer value:

```
stage name = "Adapter mapping v1"   -> [update-concept name=v1]
stage name = "Adapter mapping v2"   -> [update-concept name=v2]
```

By the time the second edit is staged the first is gone from the staged set.
An inverse operation derived from what is staged has nothing left that names
`v1`, so undo could only return to the model's own value, silently skipping a
step the reviewer took. Keeping the replaced operations around to derive
inverses from is a history of snapshots wearing a more complicated coat.

Decided: the history holds **whole `operations` arrays**. Undo swaps the
current array for the previous one and pushes the current one onto the redo
stack; redo is the same move in the other direction. The arrays are already
immutable and shared structurally, so a step costs one array of references.

Every transition that changes the staged set pushes the prior array and drops
the redo stack: `changeset.staged`, `changeset.discarded`, and
`changeset.cleared`. One row discarded and every row discarded are therefore
undoable by the same mechanism, with no separate case. Clearing an already
empty changeset pushes nothing, so the control never offers a step that would
restore the same empty list.

## History stops at the commit

`changeset.committed` empties both stacks. What has landed is a write to the
repository's own documents, and the authority that reverses it is Git — a
landed batch is reverted with `git revert`, never resurrected from the browser.
Leaving a stack behind would offer the reviewer a control that appears to undo
a commit and does not.

A refused commit is the opposite case and keeps everything: `apply.failed`
leaves the rows and both stacks exactly as staged, because the batch that
failed is still the reviewer's work in progress.

Diagnostics from a refused commit are attributed to rows by index
(`/operations/N`). Any transition that changes the staged list therefore clears
them, undo and redo included, rather than redrawing row 1's error against
whatever now occupies row 1.

## What the history deliberately excludes

Dragged positions and saved views are not in the stacks. Both persist as their
own documents with their own save and discard paths, so one shared stack would
make a single undo gesture ambiguous between un-staging an edit and moving a
node back.

The stacks are unbounded, browser-local state: never serialized onto the wire,
never persisted, and not carried by `VisualAppSnapshot`, so a reconnect leaves
them alone exactly as it leaves the staged changeset alone. No depth cap is
needed for something that cannot outlive the tab and holds references to
operations the staged set already holds.

## The wire does not move

Undo and redo are two local reducer actions and two controls in the changeset
tray. No server frame, no browser input, and no protocol field changes, so
the published protocol is unaffected by this change: the runtime still learns
what the reviewer decided only when a commit arrives.
