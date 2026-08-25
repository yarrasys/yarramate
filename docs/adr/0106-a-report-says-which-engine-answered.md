# A report says which engine answered

Status: accepted

A report has always said which catalogue asked its questions: `catalogue`
carries `id@version`, and every question carries `since`, the catalogue
version it first appeared in ([ADR 0063](0063-the-catalogue-deepens-honestly.md)).
Nothing said which engine answered them.

That gap has a cost only one kind of reader pays, and it went unnoticed
because yarramate had no such reader until now.

## The three reasons an answer flips

| Cause | Attributable before this ADR |
| --- | --- |
| The model changed | Yes. The model is the input. |
| The catalogue deepened and added a question | Yes, via `since`. |
| **The engine's condition semantics changed** | **No. Nothing recorded it.** |

The third is not hypothetical. [ADR 0097](0097-relationship-endpoints-are-validated-against-the-archimate-relationship-table.md)
replaced four aspect rules with the ArchiMate 3.2 relationship table, so
`missing-relationship` began answering differently for an unchanged model and
an unchanged question, with no `since` bump because no question was new.
[ADR 0083](0083-a-kind-nothing-constrains-is-a-label.md) records the same
effect from the other side: under the full table `unconstrained-kind` goes
near-empty, so `kind-untested` closes en masse for reasons no model caused.
Measured on a real workspace, `showcases/kafka` in the gallery checks clean
under 0.22.0 and reports thirteen errors under 1.0.0, on a file neither
version edited.

## Why ADR 0063 did not already cover this

ADR 0063 chose honest reopening, no pinning, and no stored state, and it was
right. Its reader is **stateless**: it re-runs the interview and reads the
current answer, so a re-baselined report costs nothing.

The first consumer to persist the answers is ApertureX, which spawns each open
question into a row in D1. There an engine change does not re-baseline a
report, it mass-closes and reopens a live queue, which is a question-fatigue
and trust failure rather than a cosmetic one. ADR 0063 did not contemplate
that reader because it did not exist.

## Decided

**The interrogation report carries `semantics`, the version of condition
evaluation itself.**

- **It is not the package version.** Every patch bumps that and almost none
  change what a condition means, so a consumer diffing on it re-baselines
  constantly and learns to ignore it. A signal that fires on noise is worse
  than no signal, because it is trusted once and then discounted.
- **It bumps only when an existing question's answer can change for an
  unchanged model.** Not for a release, not for a new condition, not for a
  catalogue edit, not for a rendering change. ADR 0097 and ADR 0083 would
  both have bumped it; every visual-editor release between them would not.
- **It starts at `1`.** It cannot describe history it was not present for, so
  `1` means "the semantics shipped in 1.1.0" and absence means "older than
  that", which is all a consumer needs to know.
- **It is required, not optional.** A field a consumer cannot rely on does not
  solve the problem it was added for. The cost is stated below.

## The compatibility cost, stated

The report schema and the copy inside `ask-result` are both
`additionalProperties: false`, so **output from 1.1.0 fails validation against
a pinned pre-1.1.0 schema**. The schemas ship with the package, so the pair
moves together for anyone who upgrades normally; only a consumer pinning a
schema copy independently of the runtime is affected. This is a minor, and the
changelog says so plainly rather than letting a consumer discover it.

## The backstop, because the rule is otherwise unenforced

A version that must be bumped by hand is a version someone forgets on exactly
the commit that matters. `test/interrogation-semantics.test.ts` exercises every
condition the engine understands against one fixture and fingerprints the
answers. Changing what a condition means fails that test, and the failure names
the version to bump and the new fingerprint to record.

It deliberately fingerprints **answers**, not the report: adding a question, a
wave, or a rendering leaves it alone, because none of those changes what an
existing question answers. This is the same argument
`scripts/check-changelog.mjs` makes for changelog entries, applied to a promise
that is otherwise kept only by memory.

## Deliberately not done

- **`design-step` does not carry it.** Its `progress` is a flattened summary
  rather than a report, and a design step is a turn in an interactive loop, not
  an artifact anyone persists. Adding a field there would widen a published
  contract for no reader. Revisit if a consumer ever stores design steps.
- **`reconcile`, `check`, `rtm` and `apply` do not carry it.** A reconcile
  finding has the same property in principle, and no consumer persists those
  today. Doing all six at once would widen five contracts on speculation. The
  shape here is reusable when a reader appears.
- **The catalogue is not pinnable.** ADR 0063 refused that and this ADR does
  not reopen it. Recording which engine answered is the opposite of pinning: it
  lets a model age honestly while telling the reader why an answer moved.

## Consequences

A consumer holding stored answers compares the `semantics` it stored against
the one it just received. Equal means a flip is about the model and belongs in
front of a user. Different means the engine moved, and the right response is to
re-baseline silently rather than to reopen someone's queue.
