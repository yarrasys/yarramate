# An observation is a write, addressed by its pair

Status: accepted

`yarramate apply` compiled the whole candidate workspace before writing a
byte, and could not write an observation. Evidence overlays were outside it,
so the only way to record what a provider read was to open
`.yarramate/evidence/*.yaml` and type into it — exactly the hand-authoring the
`design` → `apply` loop exists to prevent. Issue #177 measured the cost: 20
subjects created by the visual work carried no observation at all, and nothing
in the gate noticed, because the write surface that could have recorded them
did not exist.

That matters more than a workflow nit. Evidence is where honesty lives: the
atomic gate, the located diagnostic, and the splice writer's byte-identical
untouched regions all protect concepts and relationships. An observation — the
claim that says _this really exists and here is the artifact proving it_ — got
none of that protection and was authored by the least validated path in the
repository.

Decided: `operations/v1` gains `add-observation`, `update-observation`, and
`delete-observation`. They are addressed by manifest path like every other
operation, and they land through the same batch.

```yaml
format: yarramate/operations/v1
operations:
  - op: add-observation
    document: .yarramate/evidence/repository.yaml
    observation:
      subject: yarramate-engine#commit-visual-changeset
      key: exists
      value: "true"
      result: confirmed
      evidence:
        uri: repo:src/adapters/visual/session-server.ts
        message: The commit handler calls applyOperations
```

## The address is the pair, not an id

A concept operation names an `id`. An overlay entry has none. The pair
`(target, key)` is what `reconcile` already treats as unique per document —
it is the pair `YM803` rejects a duplicate of — so it is the address here too,
and no new identity is minted. `target` is `subject` or `claim`, never both,
which the schema enforces as a `oneOf` rather than leaving to the writer.

A keyless observation is not a wildcard. It is the presence claim for its
target, addressable in its own right, and an operation that omits `key`
matches only the entry that also omits it.

The consequence for the schema is that `add` and `update` cannot share a
shape. `add` requires `result` and `evidence`, because an entry without them
asserts nothing. `update` requires neither, because it names an address and
changes whatever else it lists; `value` still depends on `key`, since `key`
without `value` is a different address rather than a partial write. Sharing
one `$defs` entry between them would have forced `add` to accept an
assertionless entry or `update` to restate the whole observation on every
edit.

## The atomic gate extends, and it extends by evaluating

The first of issue #177's open questions was whether the atomic gate covers
overlays, given that the compiler never reads them. "The whole workspace must
compile" says nothing about a file that is not a compiler input.

It extends, restated: the model documents must compile, and every overlay the
batch touched must load and evaluate against the graph that batch just proved
compiles. An observation naming a subject that does not exist is rejected by
`apply`, not discovered later by `reconcile`. Nothing is written until both
pass, so a batch that adds a concept and records the observation proving it
lands whole or not at all.

Only touched overlays are evaluated. Pre-existing drift elsewhere in the
workspace is `reconcile`'s report to make; failing an unrelated batch for it
would make every edit hostage to a stale entry nobody in this batch read.

## Retraction is deleting the entry, and `remove` is only the message

The second question was whether `remove` and retraction apply to observations
at all, since a provider re-run legitimately replaces what it wrote.

An entry that no longer holds is deleted: `delete-observation` retracts it,
and unlike a concept deletion it stages no reference-integrity check, because
an overlay entry is nobody's reference target. A provider re-running replaces
its entries the same way — delete and add, or update in place — and needs no
special verb.

Field-level `remove` accepts exactly one field: `evidence.message`. `result`
and `evidence.uri` are what make the entry an observation, so removing either
leaves a shape `add` would have refused, and `value` is half of the address.
The prose note is the only genuinely optional thing an entry carries, and it
is the only thing `remove` can take back. Setting and removing the same field
in one operation is a contradiction the batch rejects rather than resolves.

## Provenance is a property of the document, not the operation

The third question was whether provider-authored overlays and human-authored
ones need different treatment, since the loop should not invite hand-authoring
of something a provider owns.

They do not, because `provider` is a document-level field naming _how the
world was read_, not _who typed the file_. An agent that uses `apply` to record
a `repository-audit` observation is claiming it performed a repository audit —
the identical claim the audit's own writer makes. `apply` cannot check that
claim for either of them, and pretending to by gating on a provider allowlist
would encode a registry this repository does not have.

What follows is a convention, not a check: a provider that regenerates its
document wholesale should own a document nobody else writes, because
regeneration drops entries it did not author. The manifest already lets a
workspace declare as many overlays as it needs. `apply` enforces only what it
can see — the overlay is listed in the manifest, it loads, and it evaluates.

## What this does not do

It does not let the browser author evidence. The visual changeset carries
observation operations through to `apply` unchanged, and the tray can describe
one, but no inspector control composes one yet. A reviewer who adds a concept
on the canvas still has no path to the evidence for it — that path is a
surface, and this ADR is the write verb it will need.
