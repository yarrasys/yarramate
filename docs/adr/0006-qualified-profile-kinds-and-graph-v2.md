# Qualify profile kinds and introduce semantic graph v2

Status: accepted

> Graph v2's interchange stability and canonical serialization are established
> by ADR 0011.

## Context

The product contract requires explicit, versioned vocabulary extensions.
Local kind names are concise for authors but ambiguous when documents using
different profiles compile into one graph.

## Decision

Profile documents use `yarramate/profile/v1`, a stable profile ID, a quoted
major/minor version, one parent profile, and closed concept/relationship kind
declarations.

Every extension kind declares a globally qualified semantic parent. Concept
kinds inherit their parent's semantic aspect. Relationship kinds inherit
endpoint constraints and may only narrow them.

Documents continue to author local kind names under one selected profile.
Compiled graph v2 represents every Core and extension kind as
`<profile-id>@<version>#<kind-id>`. Concept kind claims carry that identity as
their value; relationship claims use it as their predicate.

Profiles resolve by semantic identity rather than source order. Local names
cannot shadow inherited kinds. The graph records the complete lineage of every
selected profile.

## Consequences

Compiled graphs can combine multiple vocabularies without kind collisions,
while routine document authoring remains concise. Changing a profile version
changes the compiled kind identity and is therefore visible to Git and
downstream consumers.

Graph v2 supersedes graph v1's unqualified kind values and Core-specific
relationship predicate path. Source document v1 remains valid.

Profile files must be supplied explicitly to the compiler or CLI. Automatic
repository discovery, multiple inheritance, adapter mappings, external
registries, and remote retrieval remain undefined.

The profile format, inheritance behavior, and wording are original YarraMate
semantics. Compatibility profiles remain separately licensed and governed.
