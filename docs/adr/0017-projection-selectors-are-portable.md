# Projection selectors are portable

Projection selectors may name documents, kinds, owners, constraints, or
statuses that are absent from the current graph. An unmatched selector is a
valid query that contributes no matches, rather than a correctness error. This
keeps projections reusable across partial and incrementally adopted
workspaces, while malformed selector syntax remains a schema error.

## Status

Accepted.

Strict workspace-bound selector resolution is not part of projection v1. It
may be introduced later only as an explicit opt-in if real use cases justify
the added adoption cost.
