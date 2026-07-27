# Add semantic projections and JSON context

Status: accepted

## Context

The product contract defines projections as versioned semantic queries with
optional presentation hints. The self-model needs focused product and engine
contexts without maintaining separate diagrams or duplicate models.

## Decision

Projection v1 filters compiled graph-v2 concepts by document ID, globally
qualified kind identity, and operational lifecycle status. Filters combine
with logical AND.

A projection either excludes relationships or includes relationships whose two
endpoint concepts are both selected. Its result includes only claims about
selected concepts and selected relationships.

Presentation may supply a title and description. These hints have no semantic
authority and do not affect query results.

`yarramate context` loads one projection plus explicit workspace sources and
emits deterministic `yarramate/projection-result/v1` JSON. It writes no model
or compiled artifact. `yarramate view` renders the same closed result as
deterministic Markdown for reviewers.

## Consequences

People and agents can request focused context from the canonical graph without
creating parallel models. Generated context is reproducible and suitable for
CI or harness input.

Projection v1 initially omitted traversal. ADR 0028 subsequently adds
qualified relationship-kind filtering and one explicit, bounded one-hop
connected mode. It still does not define arbitrary predicates, recursive
reachability, layout, renderer configuration, remote sources, or adapter
output.

The query behavior and wording are original YarraMate definitions.
