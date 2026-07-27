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
metadata. Selected lifecycle, ownership, constraint, access-mode, and
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
when projection and mapping ownership match; arbitrary existing directories
remain protected. Each projection uses its own project directory because
LikeC4 merges all source files within one project.

YarraMate dogfoods this path through a bounded explicit-subject projection of
its own native engine model and a separate versioned LikeC4 mapping.

## Status

Accepted.
