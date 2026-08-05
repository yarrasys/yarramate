# A non-goal is a subject retired at birth

Status: accepted

Good PRDs carry a Non-Goals section; the model had no honest home for
"we considered X and will not do it" (#153). Retiring a requirement at
inception already works mechanically: ADR 0064 closes every question
against it, and catalogue 0.5 prescribes retirement for descoping. But
it read as history rather than as a standing decision, and no export
rendered it as the section stakeholders actually look for. The markdown
export listed a retired requirement as one inventory bullet with a
status suffix and no rationale; the brief rendered it inside "Why this
exists" indistinguishable from a live requirement.

Decided: the convention suffices, no new status value. A goal, outcome,
or requirement authored with `status: retired`, rationale in its
description, IS the non-goal record. A distinct lifecycle value (a
`declined` marker) was considered and rejected: it is contract surface
across the schema, the projection vocabulary, the evaluator, and every
adapter, bought only to distinguish "retired at birth" from "retired
later", a distinction the description already carries in prose. The
issue leaned convention until rendering proves ambiguous; rendering did
not prove ambiguous.

The rendering decision belongs to the renderers, not the projection
evaluator. Membership stays the projection's job: a projection whose
`excludeStatuses` lists `retired` drops those subjects from the result,
nothing reaches any renderer, and exclusion wins (PR #130 semantics are
untouched). Where retired subjects ARE in the result, the two
stakeholder renderers share one predicate (`isDeclaredNonGoal`):
`export markdown` appends a "Non-goals" section restating each declared
non-goal with its rationale while keeping it in the Concepts inventory,
so relationship endpoints still resolve; the brief closes with a
"Non-goals" section ("Requirement "X" is declined: ...") and keeps
those subjects out of "Why this exists". Because the brief renderer
also backs `ask` slices and the design verb, those surfaces inherit the
section, which is consistent: bounded implementation context should say
what not to build. Under a budget the non-goal paragraphs are the first
omitted; they inform, they are not the work.

The set is goal, outcome, and requirement only. Constraint and
principle are motivation-layer kinds, but retiring one lifts a rule
that used to bind; presenting that as declined scope would misread it,
so they render as they always did. Retired subjects in every other
layer are history, not non-goals, and stay out of the section.

Consequences: catalogue 0.6 names descoping-at-inception in the
requirement-unrealized and goal-unrealized resolutions. The bump
follows the 0.5 precedent, where a resolution-prose-only diff took a
minor version; no question or trigger changes, so no completed
interview reopens and every `since` annotation stands. Relationship
counterpart semantics need no change: the enrichment evaluator's
trigger checks scan the unfiltered relationship claims, so a
counterpart being retired, at birth or later, still satisfies
missing-relationship and missing-linkage conditions, exactly as ADR
0064 promised.
