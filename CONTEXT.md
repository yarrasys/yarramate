# YarraMate

YarraMate is an open-source semantic architecture engine and guided
methodology. It turns architectural intent into structured, testable context
for people and agents.

## Language

**Workspace**:
A repository-native collection of YarraMate source documents, profiles,
policies, and adapter configuration.
_Avoid_: LikeC4 project, governance server

**Semantic graph**:
The tool-neutral graph compiled deterministically from native YarraMate
documents.
_Avoid_: Diagram, Graphify graph

**Claim**:
A sourced assertion about a subject, including its kind, relationship,
classification, constraint, or evidence.
_Avoid_: Metadata field, unqualified fact

**Concept kind**:
A named semantic category available to elements, such as `goal`, `capability`,
or `applicationComponent`.
_Avoid_: Shape, node type

**Relationship kind**:
A named semantic connection between concepts, such as `realization`,
`assignment`, or `triggering`.
_Avoid_: Arrow type, edge style

**Profile**:
A versioned vocabulary and set of semantic constraints that extends YarraMate
Core.
_Avoid_: Theme, adapter

**Projection**:
A versioned semantic query with optional presentation hints. It may produce a
diagram, report, or agent context.
_Avoid_: Canonical diagram, separate model

**Conformance rule**:
A deterministic restriction over documents, claims, kinds, relationships, or
adapter mappings.
_Avoid_: Architectural taste, rendering rule

**Adapter**:
An optional integration that imports, exports, renders, or supplies evidence
without defining YarraMate Core.
_Avoid_: Core dependency

**Evidence provider**:
An adapter that resolves declared claims against observed sources such as
repositories, catalogues, tests, or runtime systems.
_Avoid_: Authority over architectural intent

**Compatibility profile**:
A separately governed mapping between YarraMate semantics and an external
language or standard.
_Avoid_: Certification or conformance claim
