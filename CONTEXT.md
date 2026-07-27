# YarraMate

YarraMate is an open-source semantic architecture engine and guided
methodology. It turns architectural intent into structured, testable context
for people and agents.

## Language

**Workspace**:
A repository-native collection of YarraMate source documents, profiles,
policies, and adapter configuration.
_Avoid_: LikeC4 project, governance server

**Workspace manifest**:
A versioned, explicit, traversal-safe index of files belonging to one
workspace.
_Avoid_: Automatic discovery, build system, governance configuration

**Semantic graph**:
The tool-neutral graph compiled deterministically from native YarraMate
documents. Graph v2 is a normative, canonically serialized interchange
contract.
_Avoid_: Diagram, Graphify graph

**Claim**:
A sourced assertion about a subject, including its kind, relationship,
classification, constraint, or evidence.
_Avoid_: Metadata field, unqualified fact

**Owner**:
The single concept referenced as accountable steward of another concept.
_Avoid_: Approver, workflow participant, inferred team

**Constraint reference**:
An identified declaration that a concept requires another concept representing
an architectural restriction.
_Avoid_: Embedded policy engine, compliance result, free-form metadata

**Constraint assessment**:
An evidence-provider observation about an existing constraint claim.
_Avoid_: Core validation result, approval, canonical compliance status

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

**Portable selector**:
A well-formed projection selector that may have no match in a particular
workspace without becoming invalid.
_Avoid_: Broken reference, mandatory workspace dependency

**Conformance rule**:
A deterministic restriction over documents, claims, kinds, relationships, or
adapter mappings.
_Avoid_: Architectural taste, rendering rule

**Check result**:
A versioned machine-readable outcome containing deterministic correctness
diagnostics.
_Avoid_: Approval record, completeness score, human console text

**Diagnostic result**:
A versioned machine-readable correctness failure shared by semantic commands.
_Avoid_: Successful command output, invocation error, policy verdict

**Adapter**:
An optional integration that imports, exports, renders, or supplies evidence
without defining YarraMate Core.
_Avoid_: Core dependency

**Adapter mapping**:
A versioned companion document connecting globally qualified native subjects
to opaque identities owned by one adapter.
_Avoid_: Native metadata, generated claim, canonical external model

**Evidence provider**:
An adapter that resolves declared claims against observed sources such as
repositories, catalogues, tests, or runtime systems.
_Avoid_: Authority over architectural intent

**Evidence overlay**:
A versioned provider report evaluating existing graph subjects or claims
without modifying canonical intent.
_Avoid_: Observed semantic graph, approval record, generic metadata

**Compatibility profile**:
A separately governed mapping between YarraMate semantics and an external
language or standard.
_Avoid_: Certification or conformance claim
