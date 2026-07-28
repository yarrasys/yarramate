# YarraMate glossary

This glossary records the product language used throughout YarraMate's native
formats, CLI, documentation, and architecture decisions.

## Language

**Workspace**:
A repository-native collection of YarraMate source documents, profiles,
policies, and adapter configuration.
_Avoid_: LikeC4 project, governance server

**Workspace manifest**:
A versioned, explicit, traversal-safe index of files belonging to one
workspace.
_Avoid_: Automatic discovery, build system, governance configuration

**Consumer package**:
The installable YarraMate runtime boundary containing the CLI, normative
schemas, and canonical agent skill.
_Avoid_: Repository source archive, published service, canonical workspace

**Harness skill entrypoint**:
A discovery alias through which one agent harness loads the canonical
YarraMate skill.
_Avoid_: Skill fork, harness-specific methodology, semantic authority

**Architecture discovery**:
Evidence-supported reconstruction of an existing project's architecture as a
proposal for native YarraMate documents.
_Avoid_: Automatic canonicalization, repository scraping as truth

**Architecture-first design**:
Intentional modelling of a new solution before implementation begins.
_Avoid_: Generated implementation plan, mandatory up-front completeness

**Architecture proposal**:
A candidate native-document change produced by a person or agent that becomes
declared architecture only through normal Git acceptance.
_Avoid_: Observed claim, approval workflow, automatically canonical model

**Architecture reconciliation**:
Comparison of declared architectural intent with observed project evidence.
_Avoid_: Core correctness validation, automatic remediation, compliance score

**Reconciliation finding**:
A contradicted, unknown, or unobserved evidence target retained with provider
provenance for review.
_Avoid_: Validation error, remediation instruction, replacement claim

**Reconciliation report**:
A deterministic workspace summary of evidence observations and unresolved
findings.
_Avoid_: Drift policy, CI verdict, approval record

**Semantic graph**:
The tool-neutral graph compiled deterministically from native YarraMate
documents. Graph v2 is a normative, canonically serialized interchange
contract.
_Avoid_: Diagram, Graphify graph

**Claim**:
A sourced assertion about a subject, including its kind, relationship,
classification, constraint, or evidence.
_Avoid_: Metadata field, unqualified fact

**Description claim**:
A narrative assertion attached to a concept or relationship subject. It may
record rationale, conditions, or consequences without making the prose
executable logic.
_Avoid_: Comment, adapter label, formal rule

**Identified reference**:
A stable, authored citation from a concept or relationship to another
workspace subject. Core checks identity, uniqueness, and resolution but does
not infer dependency, ownership, constraint, or workflow meaning.
_Avoid_: Unchecked prose link, relationship substitute, generic metadata

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

**Required constraint**:
An identified claim that a concept is bound by or must satisfy a referenced
rule. It declares applicability, not implementation or proof of satisfaction.
_Avoid_: Realization, enforcement result

**Realization relationship**:
A relationship claiming that its source implements or fulfils a more abstract
target. It does not by itself make the target a required constraint on the
source.
_Avoid_: Constraint applicability, automatic compliance

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

**Resolved profile context**:
An in-memory index of globally qualified concept- and relationship-kind
lineages supplied alongside graph v2 for operations that explicitly need
profile ancestry.
_Avoid_: Graph extension, serialized semantic claim, adapter mapping

**Descendant kind matching**:
An explicit projection mode in which kind selectors match their exact
globally qualified identity and resolved profile descendants. Exact matching
is the default.
_Avoid_: Implicit subtype expansion, unqualified kind matching

**Connected projection**:
A bounded projection mode that selects matching relationships incident to the
initial concept selection and includes their opposite endpoints exactly one
hop away.
_Avoid_: Transitive closure, dependency discovery, completeness inference

**Isolated concept policy**:
An optional projection choice to retain or remove concepts that are not
endpoints of any selected relationship. Retention is the default.
_Avoid_: Completeness check, architecture-quality judgment, reachability

**Starter view pack**:
Optional native projection templates addressing common architecture concerns
without asserting conformance to an external viewpoint catalogue.
_Avoid_: Mandatory views, ArchiMate compatibility profile

**Architecture state**:
An identified planning context representing a baseline, transition, or target
configuration of architecture subjects.
_Avoid_: Lifecycle status, approval stage, copied model

**Subject presence**:
A claim that a concept or relationship participates in an architecture state.
An unscoped concept participates in every state; an unscoped relationship
participates wherever both endpoints do.
_Avoid_: State-specific metadata, implementation status

**Relationship applicability**:
The architecture states in which a relationship assertion participates.
Unscoped applicability overlaps every state in which both endpoints participate.
_Avoid_: Diagram visibility, lifecycle status

**State comparison**:
A deterministic classification of subjects as added, removed, or retained
between two architecture states.
_Avoid_: Gap approval, migration plan, architectural assessment

**Conformance rule**:
A deterministic restriction over documents, claims, kinds, relationships, or
adapter mappings.
_Avoid_: Architectural taste, rendering rule

**Core contract manifest**:
A versioned declaration of the formats, command families, guarantees, and
explicit exclusions supported by one YarraMate Core release.
_Avoid_: Certification, architecture score, implementation workflow

**Check result**:
A versioned machine-readable outcome containing deterministic correctness
diagnostics and, on success, counts of the compiled documents, concepts,
relationships, and architecture states.
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

**LikeC4 project definition**:
An adapter-owned composition of semantic projections into one derived LikeC4
model containing multiple views.
_Avoid_: Canonical architecture model, copied native document

**Dynamic step**:
An adapter-owned presentation of one projected native relationship in an
ordered LikeC4 interaction view. Its description may present the native
relationship description, but order is not a Core workflow claim.
_Avoid_: Native workflow step, executable transition, completeness rule

**Evidence provider**:
An adapter that resolves declared claims against observed sources such as
repositories, catalogues, tests, or runtime systems.
_Avoid_: Authority over architectural intent

**Graphify observation**:
Provider evidence that an explicitly mapped Graphify node is present or absent.
_Avoid_: Inferred native model, automatic architecture extraction, semantic
equivalence by label

**Evidence overlay**:
A versioned provider report evaluating existing graph subjects or claims
without modifying canonical intent.
_Avoid_: Observed semantic graph, approval record, generic metadata

**Compatibility profile**:
A separately governed mapping between YarraMate semantics and an external
language or standard.
_Avoid_: Certification or conformance claim
