# A question the model never asked says so

Status: accepted

For a subject-scoped question, evaluation composed subject selection and
trigger filtering into one expression and reported `matches.length === 0`
as `open: false`. That one shape conflated three truths: no subject the
selector names exists (the question was NEVER ASKED), subjects exist and
every trigger is satisfied (ANSWERED), and subjects exist but none fire.
A host summing `!open` read all three as answered — and did: a fresh,
empty ApertureX project reported nine subject-scoped questions "answered"
across three waves, its wave rail ticked them complete, and an MCP agent
reading the summary concluded interrogation was done (#375, field evidence
from a production integration test). The host could not repair it
downstream without re-running selector semantics outside the engine — the
drift #289 exists to prevent.

This is the empty-set rule ("the honest question is not whether the count
is zero but whether anything was asked") landing in the interrogation
report itself, and the discipline already exists one level up: ADR 0125
refuses to evaluate a closed wave's questions at all, "rather than
evaluated and reported closed — the latter would say they had been asked
and answered". The same line was missing one level down.

Decided:

1. **Evaluation splits selection from trigger filtering.** A selector that
   matches no subject returns the question marked `asked: false`; a
   selector that matches subjects whose triggers are all satisfied returns
   the question closed with `asked` absent.
2. **`ReportQuestion` gains `asked?: boolean`, absent meaning true** — the
   additive discipline `catalogues` set (#345): no constructor breaks, and
   every existing reader keeps its exact meaning. Only the never-asked
   path writes the field, so a report byte-changes only where the new
   truth exists.
3. **The text rendering distinguishes the states too**: a never-asked
   question renders as `unasked <id> — nothing it selects exists yet`,
   never as `closed`, for the same reason the wave line says "not yet"
   (#334): completion must not be inferred from an empty set.
4. **The semantics version does not bump.** No question's ANSWER changes
   for an unchanged model — `open` is identical everywhere; a new field
   appears where a new distinction is reported. Bumping on additions is
   exactly what the version's own doc comment forbids.

Rejected:

- **A `subjectsConsidered` count.** The boolean is what the filed
  consumer needs (splitting an answered tally into answered vs
  never-asked); a count invites reading magnitude into a report that only
  owes the distinction. Add it when a reader needs the number.
- **A summary counter for never-asked questions.** A host holding the
  questions already holds the booleans; a counter would be a second place
  for the same truth to disagree with the first.
- **Workspace-scoped questions carrying `asked`.** A workspace-scoped
  question is always asked — the workspace exists — so the field would be
  a constant, and a constant field teaches readers to ignore it.
