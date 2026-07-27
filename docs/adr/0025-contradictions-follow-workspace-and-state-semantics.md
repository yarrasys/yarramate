# Contradictions follow workspace and state semantics

Claim consistency is evaluated across the compiled workspace rather than
within source-file boundaries. Competing whole-part claims are contradictory
only when their relationship applicability overlaps; explicitly disjoint
architecture states may describe a semantic transition. This preserves
deterministic correctness without forcing authors to split evolving
architecture into copied models or treating every historical change as an
error.
