# Writes land as one validated batch

Status: accepted

> Extended in 1.0 by
> [ADR 0100](0100-sources-come-from-a-store-and-a-batch-lands-by-compare-and-swap.md):
> the batch is still staged in memory, compiled whole and rejected whole, but
> it no longer ends in a loop of `writeFileSync`. `applyOperations` returns the
> documents it changed and a store writes them, checking every expectation
> before it moves a byte. What this ADR called atomic was true up to that last
> loop, which could leave the first document rewritten when the third failed.

The validated-write surface was one operation per invocation: safe — it
structurally cannot emit aspect violations — but expensive in an agent
loop, where eight `add`/`connect` calls meant eight turns of re-fed
context, and every strong-tier agent chose raw YAML instead. The
interview loop the seven-verb contract builds toward needs a prose
answer to land as one write.

`yarramate apply <operations.yaml> <workspace.yaml>` executes a
`yarramate/operations/v1` document: `add-concept`, `add-relationship`,
`update-concept`, and `update-relationship` operations addressed by
workspace-manifest document paths. The batch is atomic — every
operation is staged in memory, the whole candidate workspace must
compile, and any diagnostic rejects the entire batch with nothing
written, extending the no-partial-graph guarantee across files. Update
semantics are enrich-only: scalar fields replace, list fields append —
an answer never silently shrinks the model, and removals stay Git
edits. Operations aimed at missing subjects or non-workspace documents
fail as source-located `YM912` diagnostics before anything compiles.

Because `apply` takes the workspace manifest, companions resolve
automatically — the `--source` ceremony that made `add`/`connect`
awkward inside a workspace does not apply. The machine result is
`yarramate/apply-result/v1`. Under the seven-verb contract this command
becomes the write half of the design loop; `add` and `connect` remain
until the 0.7.0 clean break removes them per the migration map.
