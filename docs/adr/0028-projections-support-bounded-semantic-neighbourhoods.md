# Projections support bounded semantic neighbourhoods

Status: accepted

## Context

Kind-only projections are concise but cannot show a selected concept together
with the directly related subjects needed to understand it. Unrestricted graph
traversal would make results harder to predict, review, and serialize
deterministically.

Common architecture concerns also need to distinguish relationship semantics;
including every relationship between selected concepts can obscure the
question a view is intended to answer.

## Decision

Projection v1 accepts `relationshipKinds`, a portable list of globally
qualified relationship-kind identities. It filters relationship subjects only
and never changes the initial concept selection. An unavailable kind is a
valid selector that matches no relationships.

The `relationships` field accepts:

- `between` — include matching relationships whose endpoints are both in the
  initial concept selection;
- `connected` — include matching relationships incident to at least one
  initially selected concept, then include both endpoints;
- `none` — include no relationships.

Connected expansion is exactly one hop. An endpoint introduced by expansion
does not cause another relationship to be selected. State applicability still
applies, selector ordering does not affect output, and graph v2 is unchanged.

Projection v1 also accepts `isolatedConcepts: include | exclude`, defaulting to
`include`. Exclusion removes concept subjects that are not endpoints of any
selected relationship after relationship selection. It never removes an
endpoint, computes reachability, or judges whether the architecture is
complete. This rule and its wording are original to YarraMate and arise from
rendering the repository's broad starter views, where isolated catalogues
obscured the selected neighbourhood.

YarraMate dogfoods these rules through eight optional native starter
projections. Their wording and query composition are original. They are
templates rather than completeness requirements and do not reproduce or claim
conformance with an external viewpoint catalogue.

The LikeC4 project assembler unions subjects for one shared model but replaces
per-projection wildcard view rules with explicit mapped concept predicates.
Empty portable projections use an impossible controlled metadata predicate,
producing a valid empty view instead of exposing the unioned model.

## Consequences

Views can include useful immediate context without hidden recursive expansion.
Relationship semantics remain visible and globally qualified. Partial
workspaces can adopt the starter pack without being forced to populate every
concern. Broad views can suppress isolated catalogue entries without changing
the default behavior of existing projections or imposing a completeness rule.

More expressive query clauses, reference-claim expansion, hierarchy, layout,
and external-language viewpoint rules remain separate future decisions.
