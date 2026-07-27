# Architecture states are presence contexts

YarraMate represents optional baseline, transition, and target planning
contexts with stable architecture-state subjects and explicit presence
claims. Unscoped concepts apply to every state, while unscoped relationships
follow the intersection of their endpoint presence. This supports incremental
adoption, state projections, and deterministic added/removed/retained
comparisons without copying models, conflating lifecycle with planning state,
or changing graph v2.

State-specific values are deliberately excluded because they would scope the
meaning of existing claims and require a new graph contract. External
methodologies may map their terminology through separately governed guidance
or profiles; Core owns only the original generic state semantics.

Optional adapters may visualize a state or comparison, but their colors and
renderer rules remain presentation. Core supplies only state selection and the
added/removed/retained classification.

## Status

Accepted.
