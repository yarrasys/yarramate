# Relationship endpoints are validated against the ArchiMate relationship table

Status: accepted

[ADR 0004](0004-broad-native-conformance-and-check-cli.md) decided that Core
"validates relationship endpoints against the broad aspect restrictions in
the selected native profile" and "does not embed or reconstruct an external
kind-to-kind relationship matrix". [ADR 0003](0003-native-document-and-compiler-foundation.md)
had closed on the same note: "no external relationship matrix or derivation
rule is incorporated". Both rested on a reading of the ArchiMate licence
that was wrong. The specification is published to be implemented; what The
Open Group controls is the mark. The owner's own words on reversing it: ADR
0003 was a mistake.

This ADR records the reversal and what follows from it: the core profile
validates every relationship against the ArchiMate 3.2 relationship table,
and a model that passes `check` is semantically valid ArchiMate.

## Why four rules were not a language

The core profile has always carried ArchiMate's vocabulary exactly: the 62
element kinds, the 11 relationship kinds, the aspects and layers. What it
did not carry was the table that says which relationship may join which
pair of kinds. In its place stood four aspect rules: assignment from active
structure, access to passive structure, influence toward motivation,
triggering between behaviour. Everything else was permitted between
anything.

Measured against Archi's encoding of Appendix B, that gap was not a
rounding error. Of the combinations `check` accepted, 64% — 19,043 of
29,664 — are forbidden by the standard. In the other direction it rejected
1,803 combinations the standard permits, 1,234 of them `triggering`, which
ArchiMate derives between active-structure elements and the rule pinned to
behaviour. The repository's own skill taught a workaround for that
rejection: record the triggering as a `flow` and carry the meaning in its
name.

The consequence reached the interview. The catalogue's `component-unhosted`
resolution told an author to host a component "with a serving or
assignment relationship into the component"; a node is never assigned to a
component. Seven questions prescribed or accepted shapes the table forbids.
The repository's own model carried thirteen such relationships, the shipped
fixtures twelve more. Every one, on inspection, was a folded field or a
direction error: a function "producing" a result by realization where it
writes the result by access, a schema "describing" its instance as one data
object realizing another where the schema file is an artifact, a capability
realized by a course of action where the course of action is what the
capability realizes. None was a fact the model was wrong about. All were
shapes ArchiMate has a word for that the profile never demanded.

[ADR 0083](0083-a-kind-nothing-constrains-is-a-label.md) had already found
the symptom from the other side: with only four kinds constraining an
endpoint, 153 of the repository's 238 concepts carried a kind no rule could
contradict.

## Decided

The ArchiMate 3.2 relationship table is the rule.

- **Source.** Archi's `relationships.xml`, version 3.2, vendored under
  `vendor/archi` with its MIT licence and provenance. It encodes Appendix B
  including derived relationships, so `triggering` between two components
  is permitted exactly as the specification derives it.
- **Form.** `scripts/generate-archimate-relationships.mjs` renders the XML
  to `src/archimate-relationships.generated.ts`, a module with no imports so
  it loads wherever the compiler loads, re-keyed by core kind id with the
  single `Junction` row expanded to `andJunction` and `orJunction`. A test
  regenerates it from the vendored XML on every run and fails on a byte of
  drift. `src/relationship-matrix.ts` decodes it once.
- **Lookup.** YM404 resolves both endpoints and the relationship kind to
  their core ancestors through profile lineage, then reads the table. An
  extension kind inherits its parent's row and column; it may still narrow
  a permitted pair by aspect with `sourceAspects` and `targetAspects`, and
  that narrowing is reported per endpoint as before. YM412's narrow-only
  rule now falls back to the aspects the table ever allows the parent at
  that end, which closes the hole where an unconstrained parent accepted
  any declaration.
- **Message.** The diagnostic names the pair and lists the relationship
  kinds the table permits for it, scoped to the selected profile
  ([ADR 0079](0079-a-profile-extension-is-conservative-over-the-workspace-it-joins.md)).
  The per-kind `repair` hints are gone: they were written against the
  aspect rule and would now mislead.
- **Junctions.** A junction takes the kind of the relationships that pass
  through it, so every relationship on one junction must be the same kind.
  The table cannot say this; it rules on one pair at a time. YM414 says it.
- **Aspects.** Product, plateau, and gap are composite, as the specification
  classes them, not passive structure. Notation follows: only grouping is
  drawn dashed.

## What this supersedes

- ADR 0003's closing statement that no external relationship matrix is
  incorporated. The document and compiler-seam decisions stand.
- ADR 0004's endpoint policy. Access mode, flow content, the whole-part
  contradiction (YM501), and the `check` exit codes stand.
- ADR 0083's premise that only four relationship kinds constrain an
  endpoint. Its lineage-resolution rule and its two rejections — never
  infer a kind, never make it a `check` error — stand; the `kind-untested`
  question is redesigned under catalogue 1.0
  ([ADR 0098](0098-catalogue-1-0-asks-for-idiomatic-archimate.md)).
- ADR 0087's "no conformance claim" and its position that the word
  ArchiMate stays out of external-facing documentation. The decision that
  notation is a presentation field, and the trademark position, stand.

## What stays YarraMate-native, and why it is additive

Evidence, attestations, lifecycle `status`, `owner`, `distinctFrom`,
`supersedes`, `constraints`, and architecture states have no ArchiMate
analogue. None of them is an element kind or a relationship kind. Each is a
field on a subject, and none changes what the ArchiMate element or
relationship it annotates means. A model with those fields stripped is a
valid ArchiMate model; a model with them is a valid ArchiMate model plus the
custody layer that is the product's reason to exist. The two do not
compete for the same ground.

The shipped policy profile specializes `constraint` four ways, which is a
Chapter 15 specialization and nothing else.

## Not decided here

- Derivation. The table admits derived pairs, so a relationship the
  specification would derive is accepted when written. The engine still
  does not derive relationships that are not written: a service's data
  access is not inferred from its process, and the catalogue asks for it.
- The Open Group exchange format, and Archi as anything but a future test
  oracle.
- Any claim of certification. The core profile implements the vocabulary
  and the relationship table; that is a factual statement, not a conformance
  claim in the specification's sense.

## Consequences

- Breaking. A workspace carrying an edge the table forbids fails `check`
  with YM404 where it passed before. The migration recipes are the ones the
  repository applied to itself: `access` where behaviour produces passive
  structure, `artifact -realization-> dataObject` where a file gives a data
  object its form, `node -realization-> applicationComponent` for "deployed
  on" (the relationship the node-artifact-component chain derives), a
  swapped direction where a capability was realized by what it realizes,
  and `association` where no ArchiMate relationship carries the meaning.
- The catalogue goes to 1.0 (ADR 0098), and the skill stops teaching
  workarounds for a rule that no longer exists.
- `ask --kinds` reports the aspect shadow for all eleven relationship kinds
  and the packed table itself, additive on `ask-result/v1`.
- `inspiredBy` values read `archimate:<element>`: the element the kind
  implements, kept as data.
- The positioning documents say what the code does. The glossary's
  "compatibility profile" entry is retired; the trademark disclaimer stays,
  because it was never about conformance.
- The licensing posture ADR 0003 deferred is taken: the table is vendored
  from an MIT-licensed encoding, with provenance recorded beside it.
