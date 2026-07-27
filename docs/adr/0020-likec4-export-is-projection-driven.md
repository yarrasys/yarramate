# LikeC4 export is projection-driven

The optional LikeC4 exporter consumes a closed `yarramate/projection-result/v1`
and an explicit `likec4` adapter mapping. It emits deterministic LikeC4 logical
model source and one ordinary element view. Native documents and graph v2
remain unchanged and canonical.

The first export requires mappings for every projected concept. Relationship
syntax uses mapped endpoints and compiled relationship kinds; it does not
invent external relationship identities. Import, round-tripping, deployment
and dynamic views, styling, and layout preservation are outside this decision.

Generated subjects retain globally qualified native identities in flat
metadata. Their globally qualified semantic kinds are retained separately from
the LikeC4 declaration kind so future kind compatibility mappings cannot erase
provenance. Selected lifecycle, ownership, constraint, access-mode, and
flow-content claims may also be represented as flat metadata for traceability
and filtering. This is presentation-layer preservation, not a second semantic
authority.

The adapter is exposed through a separate package subpath and binary. Core does
not import it and remains independent of LikeC4. Its CLI failure envelope is
versioned separately because it can contain both Core source diagnostics and
adapter-specific mapping diagnostics.

The adapter CLI can also materialize a self-contained LikeC4 project
containing the model, optional profile specification, and project
configuration. A versioned derived-project marker permits repeat updates only
when the complete marker is schema-valid and projection, subject mapping, and
optional kind-mapping ownership match; arbitrary existing directories remain
protected. Regeneration also refuses symbolic links or non-file substitutions
for the project and its owned files. Content digests prevent silent overwrite
of edited or partially updated generated files; legacy markers are upgraded
on their next successful regeneration. Owned contents are staged and
atomically replaced, with the ownership marker published last, so interrupted
writes remain detectable without exposing partial file contents. A single
projection can still produce a project directly. An adapter-owned
`yarramate/likec4-project/v1` definition may instead union several projection
results into one logical model and emit one LikeC4 view per projection. The
union is rendered once, avoiding the duplicate declarations that LikeC4's
multi-file merge would otherwise create.

The same adapter pipeline is available as a non-writing check. Its optional
JSON mode uses a command-specific versioned result for both success and
failure, while Core remains unaware of LikeC4.

LikeC4-specific correctness diagnostics are source-located. A missing subject
mapping points to the native concept kind; an invalid external identity points
to the subject mapping; and bundled-vocabulary incompatibility points to an
explicit kind mapping when one caused the failure, otherwise to the native
kind. This keeps the adapter failure envelope actionable without moving
adapter rules into Core. Adapter failures follow the same source-location
ordering as Core diagnostics.

YarraMate dogfoods this path through a bounded explicit-subject projection of
its own native engine model and a separate versioned LikeC4 mapping.

The exporter can optionally consume a Core state comparison for a projection
that selects both states. Comparison classification is retained as flat
metadata and rendered with local view styles; neither styles nor external
identities enter graph v2. The ordered comparison is part of generated-project
ownership.

## Status

Accepted.
