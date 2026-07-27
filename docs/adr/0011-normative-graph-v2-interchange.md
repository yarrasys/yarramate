# ADR 0011: Make semantic graph v2 a normative interchange contract

## Status

Accepted

## Context

Adapters, projections, agents, and CI already consume deterministic graph v2.
Leaving its shape provisional forces every consumer to couple to compiler
implementation details and weakens the value of globally qualified identities.
Future evolution still needs a safe route for breaking changes.

## Decision

`yarramate/graph/v2` is a normative, version-scoped interchange contract. Its
JSON Schema is published and exported with the package. The typed
`serializeSemanticGraph` function and read-only `yarramate compile` command
produce its canonical JSON representation.

Canonical output fixes field order, array ordering, two-space indentation, and
one trailing newline. Equivalent compiled workspaces produce byte-identical
output.

Existing v2 fields, meanings, required structures, and serialization rules are
stable. Structural or semantic breaking changes require a new graph format
identifier and schema. New predicates may use the existing claim envelope;
consumers may ignore predicates they do not understand.

Graph files remain derived artifacts and are not required in Git.

## Consequences

- Adapter and agent implementations receive a dependable tool-neutral
  boundary.
- Globally qualified subject and kind identities are now an interchange
  guarantee, not merely a compiler convention.
- Source provenance is required on every declared v2 claim.
- Compiler defect fixes may change output only when the old output violated
  the normative contract.
- Future origins or claim structures that cannot fit v2 require graph v3.
