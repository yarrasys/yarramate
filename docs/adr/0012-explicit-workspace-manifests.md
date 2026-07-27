# ADR 0012: Use explicit workspace manifests

## Status

Accepted

## Context

The CLI accepts explicit source files, which is deterministic but repetitive
for profiles, multi-document models, projections, and optional mappings.
Automatic parent-directory discovery or filename classification would add
hidden repository policy and make agent and CI behavior dependent on location.

## Decision

YarraMate defines the closed `yarramate/workspace/v1` manifest. It explicitly
lists document, profile, projection, adapter-mapping, and optional evidence
patterns relative to the manifest directory.

Patterns are local, traversal-safe, matched to regular files, deterministically
sorted and deduplicated, and required to match. One resolved file may belong to
only one category.

The CLI consumes a manifest only when it is passed explicitly in place of
source files. It does not search for one. Projection selection remains
explicit. `init` creates a minimal manifest beside its initial native document.

The manifest is input configuration only. It contributes no subjects or claims
to graph v2.

## Consequences

- People, CI, skills, and agents share one reproducible source set.
- Nested examples can define isolated workspaces without affecting the root.
- Commands retain explicit-file compatibility.
- Remote registries and automatic workspace discovery remain separate future
  decisions.
- The format cannot become a metadata or governance container without a new
  explicit contract.
