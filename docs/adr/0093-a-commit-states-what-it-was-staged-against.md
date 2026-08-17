# A commit states what it was staged against

Status: accepted

The visual runtime stages mechanical edits in the browser and lands them as one
batch through `yarramate apply` (ADR 0084). Until now the commit handler read
the workspace from disk at commit time and applied the batch to whatever it
found:

```ts
const outcome = applyOperations(
  { path: "changeset.yaml", source: operationsSource },
  { path: manifestPath, source: readFileSync(manifestPath, "utf8") },
  options.cwd,
)
```

Nothing compared that read to the model the browser had rendered. Two reviewers
in two sessions could open the same workspace, stage an edit to the same field,
and the second commit would overwrite the first silently — reported as landed,
with no diagnostic and nothing on screen to say a value had moved. It was the
one remaining path where this adapter loses a write it says it kept.

Core already refuses the structurally impossible cases: an operation naming a
concurrently deleted subject fails `YM912`, and a rename whose target is gone
fails `YM312`. Those are referential rules about the shape of the graph. A
scalar replacing a scalar is a legal write at every layer, so no existing rule
sees it.

## Optimistic concurrency needs a precondition, not a counter

Three things are already tracked per session, and none of them can answer
"did this value change under me?":

| Layer | Tracks | Why it cannot answer |
| --- | --- | --- |
| Working tree vs HEAD | Committed history | The runtime never runs `git commit`; two applies between two human commits collapse into one dirty file |
| Session journal | Every browser event, in order | A crash-replay buffer under `.yarramate-out/`, gitignored and deleted with the session |
| `lastSequence` | One session's frames | Per-session counter; it cannot order writes across browsers |

`VisualModel.sourceDigests` — a sha256 per workspace source, minted when the
session request is built — was the closest thing to an answer and was being
dropped at the wire boundary: `VisualRenderedModel` never carried it, so the
browser held no statement of what it had rendered.

A version number would be a second thing to maintain and no better: optimistic
concurrency is *version + precondition checked at write time*, and the value's
own prior digest is already a perfectly good version. So the fix is the
precondition, not a new counter.

## The unit is the document, not the field

Decided: **every commit pins a digest for each document its operations touch,
and the server refuses the batch if any pin no longer matches the file.**

A per-field precondition (`(target, field)` — the granularity of
`changesetTargetKey`) would refuse strictly less: two reviewers editing
different fields of one subject could both land. It was rejected as a first
move because the expectation the browser can honestly state is the one it
derived from a compile — the digest of the source it rendered — and because
per-field prior values would have to be minted at staging time from the
rendered model anyway. Per-document is the coarser rule that costs nothing
extra and needs no new vocabulary. Narrowing it later is a refusal becoming an
acceptance, which is always the safe direction to move.

The cost is stated rather than hidden: documents in this repository hold many
subjects — `.yarramate/architecture/engine.yaml` alone carries most of a
260-concept model — so two reviewers editing unrelated subjects in one file
conflict under this rule and one of them is refused. That is a refusal of a
write that would have been correct, which is the direction this decision
deliberately errs in; the reviewer sees the new bytes and re-stages. If that
friction is measured rather than imagined, the narrowing move is per-subject
or per-field pins, not a weaker check.

Pins are derived when a row is staged, from the model frame the row was staged
against, and an existing pin is kept rather than re-read. That is the whole
point: a pin refreshed from a newer model frame would match the file on disk and
let a same-field overwrite land silently. Documents no longer targeted by any
row drop out, so discarding the last row that named a document stops vouching
for it.

A document the model does not name has no digest to pin — `apply` will create
it — so it is left unpinned rather than pinned to a digest nobody minted.

## Every targeted document is checked, not every pin sent

The server checks each distinct `operation.document`, not each entry in
`sourceDigests`. A batch that vouches for nothing would otherwise buy back the
unconditional write by omission, and a precondition nobody has to state is
decoration. Omitting a pin for a document that exists is refused as `YMVS313`;
a pin that no longer matches, or names a document that has since been deleted,
is refused as `YMVS312`.

Because the check is a precondition rather than an optional extra, an omitting
browser cannot be exempted — and that is precisely the client that cannot
detect the conflict. `sourceDigests` is therefore a required field of
`VisualChangesetCommitPayload`, which makes the wire
`yarramate/visual-protocol/v3`.

## The refusal is preserve-and-refresh

A refused commit keeps the rows staged exactly as a refused apply already
leaves them (ADR 0092), then broadcasts the freshly compiled model. The
reviewer reads the value that is there now, with the affected rows marked, and
decides: re-stage against the new value, discard the row, or reconcile the
difference by hand. The runtime does not merge, and it does not offer a
three-way resolution — what to do with a genuine disagreement is the
reviewer's judgement, not the adapter's.

Rows are marked by comparing each row's pin against the digest the newest model
frame carries for that document, so the conflict shows up as soon as a fresh
model arrives rather than only at commit time. The batch-level diagnostic names
the document; the row-level line names the edit.

## What this does not do

Nothing here reconciles two live browsers. There is no lock, no lease, no
presence, and no push to a session that did not ask: session B's commit
reaches session A only when A next compiles — which, given the refusal path
recompiles, is when A tries to commit. The claim is bounded and testable: a
batch never lands against bytes other than the ones its author was looking at.
