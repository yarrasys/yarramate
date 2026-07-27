# Projections opt in to resolved kind descendants

Status: accepted

## Context

Versioned profiles can declare semantic parent chains for concept and
relationship kinds. Exact qualified-kind selection is predictable, but a
portable projection written against a parent kind cannot deliberately include
profile extensions without naming every descendant.

Applying ancestry to every selector would silently broaden existing views.
Embedding resolved profile catalogues in graph v2 would also change a stable
interchange contract to support one evaluation concern.

## Decision

Projection v1 accepts `kindMatching: exact | descendants`, defaulting to
`exact`. The choice applies consistently to `kinds` and
`relationshipKinds`.

Descendant matching compares a selected globally qualified kind with the
resolved parent lineage of each actual kind. Resolution is transitive,
version-specific, and performed by the compiler from explicit profile
documents.

The compiler exposes a deep contextual entry point that returns graph v2 and
an in-memory resolved profile context. Projection evaluation may consume that
context. The stable graph-only compiler entry point, graph v2 structure, and
canonical graph serialization are unchanged. Without context, evaluation
falls back to exact matching.

These rules and their wording are original to YarraMate. They derive from the
native profile inheritance and projection contracts rather than an external
notation or viewpoint catalogue.

## Consequences

Reusable parent-kind projections can intentionally include local semantic
extensions. Existing projections retain their exact membership unless authors
opt in, and adapter preparation can use the same core evaluation behavior
without putting adapter fields in the semantic model.

Resolved ancestry remains runtime evaluation context rather than a new class
of canonical claims. A future need to exchange profile resolution results
would require a separate versioned contract rather than an implicit graph v2
change.
