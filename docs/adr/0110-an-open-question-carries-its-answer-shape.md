# An open question carries its answer shape

Status: accepted

A question has always travelled with everything a person needs — the
phrasing, the materiality, a prose `resolution` hint — and nothing a
machine can act on. The catalogue declares every trigger as typed
conditions (`no-subject-of-kind`, `missing-relationship`, and the rest of
the closed vocabulary in the catalogue schema), and evaluation erased
them at reporting time: neither the interrogation report nor the design
step said *why* a question was open, only that it was.

That gap has a cost only an acting consumer pays, and two of them paid it
on the same day. ApertureX, building prefilled answer forms per question
card, had to re-derive the answer shape from its own copy of the
catalogue — a copy that can silently drift from engine semantics — and
named this its one upstream enhancement. The CLI's own cold-start
dogfood paid the same cost from the other side: `design` said "add at
least one goal or outcome concept" in prose, and landing the first
concept took five failed `apply` rounds because the operations skeleton
existed nowhere in the output.

## Decision

Both envelopes carry the catalogue trigger **verbatim**: `ReportQuestion`
and the design step gain a required `trigger` field holding the
conditions exactly as the catalogue declares them. The conditions are
already a closed, schema-typed vocabulary; they *are* the machine-readable
answer shape. A host maps them onto its own affordances — a form with the
kind preselected, a relationship editor with one endpoint fixed — without
holding a catalogue copy.

The CLI renders the first such affordance itself: the human `design`
output prints a prefilled `yarramate/operations/v1` skeleton when the top
question's trigger has exactly one condition that maps unambiguously onto
one operation — `no-subject-of-kind` onto `add-concept`,
`missing-relationship` onto `add-relationship` with the direction-fixed
endpoint prefilled with the subject. Every other trigger leaves the
output exactly as before: a wrong skeleton is never offered. Extending
coverage is one new mapping case.

## Excluded options

- **A normalized remedy DSL** on the report (`{op, kindOptions}` and
  siblings): a second vocabulary whose alignment with the condition
  vocabulary would itself need versioning. The conditions are already
  typed and closed; hosts translate once.
- **A `proposedOperations(question, subject)` helper in the engine**: it
  couples interrogation to authoring shapes. If wanted later it layers on
  top of the exposed trigger in the authoring toolkit, not in the engine.
- **A semantics bump**: [ADR 0106](0106-a-report-says-which-engine-answered.md)'s
  rule is answers-changed-only, and no answer changes — the same
  questions open and close for the same models.
- **An optional schema field**: the trigger exists for every catalogue
  question, so an optional field would force every consumer to write an
  absent-case branch for a case that cannot occur. It is required, with
  the same compatibility note the 1.1.0 `semantics` field carried.

## Consequences

The report and design-step schemas gain a required field under
`additionalProperties: false`, so output from this version fails
validation against a pinned pre-change schema. The one consumer known to
validate (ApertureX) upgrades schemas together with the package and is
unaffected; the changelog carries the warning for anyone who pins
separately. The condition definitions are copied into both output schemas
from the catalogue schema, keeping each schema self-contained.
