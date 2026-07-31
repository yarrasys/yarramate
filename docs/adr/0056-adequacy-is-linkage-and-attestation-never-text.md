# Adequacy is linkage and attestation, never text

Status: accepted

The interrogation engine could see absence but not thinness: a
five-word goal with one relationship closed every question that would
ever ask about it, and two designers modeling the same specification
produced 47- and 27-concept models with nothing to interrogate the
difference. "Filled" needed to become "filled adequately" without the
engine reading words — the wiring-not-words boundary is permanent.

Two mechanisms, layered, both deterministic. **Linkage depth**: new
trigger conditions hold a question open until a blank's neighbourhood
exists — `missing-linkage` requires a relationship of given kinds, in a
given direction, whose counterpart is of a given kind, and
`missing-reference` requires a reference-bearing claim such as a
constraint binding. **Attestation**: a question stays open until an
authority records a judgment in the model. Concepts may declare
`attestations: [{topic, by, on}]`, compiling to a
`yarramate/attestation/<topic>` claim; the `missing-attestation`
condition sees only the claim's existence. The judgment lives outside
the engine; its record is structural, stateless, and revocable by
deletion, with both the signing and the revoking reviewed at the Git
boundary. Text heuristics were rejected: length thresholds and
name-mention checks erode the boundary for little gain.

All relationship-kind matching in conditions now resolves through
profile lineage by default, the same rule as subject selectors — a
catalogue written against core kinds must see a profile-derived kind
such as `implements`. Exact matching remains available per condition.

The shipped catalogue grows to 0.3: motivation, business, and a new
application wave (29 questions; technology and implementation follow),
with contribution questions scoped to planned and current elements —
retired ones owe nothing. Enriching the self-model until the deep
catalogue closed rediscovered real drift (eight CLI commands never
linked to their component) and forced forty ownership decisions, which
is the catalogue doing exactly what it ships to do.
