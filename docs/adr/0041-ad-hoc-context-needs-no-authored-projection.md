# Ad-hoc context needs no authored projection

Status: accepted

Mid-task, an agent or person often needs one bounded slice around a known
subject — a question, not an artifact. Requiring an authored projection file
for every such question turns exploration into authoring and prices the
query wrong.

`yarramate context --subject <document-id>#<local-id>` evaluates an
ephemeral projection over the explicit subjects with their connected
neighbourhood, using the existing evaluator, selector semantics, and
`yarramate/projection-result/v1` contract unchanged. The ephemeral
definition is identified as `ad-hoc-context@0.0` in the result. Subjects
must be globally qualified, and unknown identities fail loudly rather than
returning a silently empty slice.

Authored projections remain the reviewable, reusable, renderable unit:
ad-hoc context is never written to the workspace, cannot be referenced by a
LikeC4 project, and introduces no new selector semantics. Deeper
neighbourhood radii stay future work for the projection language itself.
