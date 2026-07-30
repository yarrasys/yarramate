# The adapter check gates mapping coverage, not renderability

Status: accepted

`yarramate-likec4 map --sync` writes a mapping entry for every projected
subject, concepts and relationships alike, while the read-only check only
walked concepts. A mapping missing relationship entries therefore passed the
check and was silently rewritten by the next sync. Guidance that makes the
read-only check the CI gate and sync an authoring command inherited that
hole: in CI the repair is discarded with the runner, so the drift recurs
every run and is never reported.

The check now reports a projected relationship with no mapping entry as
`YMLC111`, located at the relationship in its native document and summarized
like its concept sibling when many are missing. A green check therefore means
what the guidance already claimed: a later sync would add nothing.

Rendering stays permissive. A generated view selects a relationship through
its `yarramateId` metadata rather than an external identity, so a concept-only
mapping still exports correctly, and `export` and `export-project` continue to
accept one. The asymmetry is the point — the check answers "is this mapping
complete", which is a question about synchronization, while the exporters
answer "can this be rendered". Only the first is a gate, so only the first
fails.
