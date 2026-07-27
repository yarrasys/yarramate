# Define the first native document and compiler seam

Status: accepted

> Graph v1 kind identity is superseded by ADR 0006. The source-document and
> compiler-seam decisions remain in force.

## Context

ADR 0002 requires native, claim-centred, tool-neutral YarraMate documents.
Routine authoring must stay concise, while compiled meaning must be explicit,
stable, source-located, and deterministic. The product contract also requires
profile extensibility and forbids adapter authority in Core.

## Decision

The first source format is closed YAML identified by `yarramate/v1` and
validated structurally by a normative JSON Schema. A document declares a
stable kebab-case ID, one explicit versioned profile, concise concepts, and
concise relationships. It has no generic metadata object.

Local concept and relationship IDs share one document namespace, and document
IDs are unique within a compiled workspace. Canonical subject IDs combine
document and local identity with `#`. References are local concept IDs in this
first format. Relationship IDs are authored.

The compiler module presents one interface, `compileWorkspace(sources)`. It
returns either a complete `yarramate/graph/v1` semantic graph or source-located
diagnostics. Authored concepts expand into declared kind, name, and optional
description claims. Authored relationships expand into declared relationship
claims and optional name claims. Output is lexically ordered.

JSON Schema owns structural correctness. A selected versioned profile owns
vocabulary correctness, so kind fields are not frozen as schema enums.

## Consequences

Moving source files and reordering lists preserve semantic identity. Git diffs
remain concise while agents receive explicit claims. Unknown fields and kinds
fail rather than becoming unstructured metadata. LikeC4, Graphify, external
language mappings, layout, and approval state have no place in the graph.

Cross-document references, profile discovery, richer controlled claim
shorthand, endpoint compatibility, and a long-term interchange guarantee are
deferred. The compiled graph is versioned for deterministic 0.x consumption
without promising that its first shape is permanent.

The wording and rules in this decision are original YarraMate definitions.
The existing native kind catalogue is their repository provenance; no
external relationship matrix or derivation rule is incorporated.
