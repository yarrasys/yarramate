# YarraMate product contract

This document records the foundational decisions agreed before implementation
of the native conformance engine.

## Definition

YarraMate is an open-source semantic architecture engine and guided
methodology. It owns a tool-neutral semantic graph, validates architectural
claims and rules, generates task-specific context and projections, and
supports incremental solution design through human and agent interfaces.

## Primary product journeys

YarraMate serves two primary repository-native journeys:

1. **Architecture discovery** — an agent harness invokes the CLI while
   inspecting an existing project, then proposes a native architecture model
   supported by repository evidence.
2. **Architecture-first design** — people and an agent harness explore a new
   solution before implementation, recording agreed intent directly in native
   documents.

Both journeys converge on the same versioned documents, profiles, claims,
projections, diagnostics, and Git review boundary. YarraMate does not maintain
separate discovered and designed canonical models.

Discovery observations and generated documents are proposals until accepted
through the repository's normal Git process. Evidence supports or challenges
claims but cannot silently author declared intent. Architecture-first design
may begin without implementation evidence; deterministic correctness does not
pretend that the proposed design is complete or good.

Agent harnesses orchestrate the stable CLI and consume its machine-readable
contracts. They do not require a privileged agent API, database, governance
server, or tool-specific canonical format.

The installable consumer package contains the built CLI and library runtime,
normative schemas, consumer guidance, and one canonical agent skill. It does
not contain the YarraMate repository self-model, source, tests, research, or
fixtures. The public repository may expose that same skill through a generic
agent-skill installer. Installed directories and harness-specific links are
deployments and must not fork its methodology. Packaging and local installation
do not imply publication or licensing approval.

## Canonical model

- Versioned, tool-neutral YarraMate documents are stored as reviewable text in
  Git.
- Those documents compile into the in-memory semantic graph.
- YAML is the intended human-authored representation; a JSON Schema defines
  its normative structure.
- Compiled output is reproducible and ignored by default.
- A workspace may commit compiled output for offline or downstream consumers.
- LikeC4 and other formats are adapters or projections, not the canonical
  semantic representation.

## Semantic independence

YarraMate Core is an independent language with original definitions and rules.
It may cover concepts familiar from established enterprise-architecture
practice without being a renamed implementation of another language.

Exact mappings, relationship matrices, derivation rules, exchange behavior,
and conformance claims for an external language belong in separately licensed
and governed compatibility profiles.

## Claims

A claim is the fundamental semantic unit. Elements and relationships provide
stable subjects, while kind, ownership, realization, status, dependency,
constraint, description, identified reference, and evidence are claims.

Claims may originate as:

- `declared` — authored architecture
- `derived` — deterministic YarraMate inference
- `observed` — reported by an evidence adapter

Routine authoring syntax must remain concise and compile into claims. The first
release does not introduce an approval lifecycle, identities, signatures, or
workflow orchestration.

Controlled operational lifecycle status may distinguish `planned`, `current`,
and `retired` architecture. These values are semantic claims, not approval or
review states.

The first native format uses closed YAML records for concepts and
relationships and deliberately has no generic metadata bag. Document-local
authored IDs compile under a stable document namespace; source file paths and
list positions are not semantic identity. JSON Schema governs structure while
the selected versioned profile governs valid vocabulary.

Relationship endpoints may use local concept IDs or explicit
`document-id#concept-id` references. Resolution occurs only within the
documents supplied to the workspace compiler and never depends on file paths.

Concept and relationship descriptions are narrative claims about their
subjects. Identified references provide checkable citations from either
subject type to any concept, relationship, or architecture-state subject in
the compiled workspace. Description prose remains opaque: Core checks
reference records, not strings that happen to resemble IDs, and does not
interpret prose as executable logic.

## Repository-native operation

YarraMate behaves as a repository-native tool:

- Git provides authorship, review, history, and approval.
- Committed model content is declared architecture.
- Agents use the repository and harness permissions already in force.
- CI may validate or compile artifacts deterministically.
- YarraMate does not operate a separate governance server.

Graphify follows the same operational pattern but has different authority:
Graphify primarily derives observed facts; YarraMate primarily compiles
declared architectural meaning.

## Interfaces

The CLI is the stable product contract for humans, CI, and agent harnesses.
The YarraMate skill is an optional conversational methodology over the CLI and
schema. A web interface may be added later without becoming the semantic
authority.

The intended command families are:

```text
yarramate init
yarramate design
yarramate apply
yarramate ask
yarramate check
yarramate reconcile
yarramate export
```

Machine-readable checking uses the versioned
`yarramate/check-result/v1` contract. It reports deterministic correctness
diagnostics and successful-workspace subject counts; it is not an approval,
completeness, shrink policy, or quality score. Consumers decide whether a
count change is acceptable.
Other JSON-producing semantic commands report correctness failures through
the versioned `yarramate/diagnostic-result/v1` contract.

A versioned workspace manifest may explicitly enumerate local documents,
profiles, projections, adapter mappings, evidence overlays, and Core contract
manifests. Paths resolve relative to the manifest with deterministic,
traversal-safe glob expansion. The CLI never searches parent directories for
a manifest or infers governance from it.

Repositories may colocate canonical workspace inputs under `.yarramate/` and
place reproducible derived artifacts under the ignored `.yarramate-out/`.
These are repository-layout conventions rather than additional semantic
formats: moving a source file does not change its document or subject identity.

A Core release may publish a versioned contract manifest declaring its
tool-neutral formats, command families, deterministic guarantees, and explicit
exclusions. `check` verifies its repository and package integrity. This
manifest is not certification, completeness policy, or external-language
conformance.

## Validation

Core `yarramate check` enforces correctness:

- document schema validity
- unique and stable identifiers
- valid concept and relationship kinds
- resolvable references
- relationship endpoint compatibility
- required fields for selected kinds
- controlled metadata values
- resolvable identified subject references with subject-local unique IDs
- absence of contradictory declared claims
- adapter mapping integrity
- Core contract schema, reference, normative-schema, declared-format,
  package-export, and binary integrity

Core validation does not fail merely because a recommended owner, realization,
viewpoint, layer, or design practice is absent. Completeness and governance
checks are opt-in profiles or project policies.

Compiler diagnostics use stable category codes and source locations. A
compilation with errors produces no partial semantic graph.

The bundled native profile initially expresses endpoint compatibility through
broad aspect restrictions with original YarraMate wording. Exact external
kind-to-kind matrices remain compatibility-profile concerns. Controlled
relationship fields compile into claims and are valid only for the
relationship kinds that define them.

## Extensibility

YarraMate ships a bundled native vocabulary. Projects extend it through
explicit, versioned profiles. Extensions declare semantic parents, constraints,
and versions; unknown kinds are not silently accepted.

This mechanism supports organization vocabularies and optional security,
regulatory, governance, and external-language compatibility profiles.

Profile documents declare one versioned parent profile and globally qualified
semantic parents for every extension kind. Documents use concise local kind
names under their selected profile; compiled graphs use
`profile-id@version#kind-id` for both Core and extension kinds. Relationship
extensions may narrow inherited endpoint constraints but cannot broaden them.

## Projections

A projection is a versioned semantic query plus optional presentation hints.
Its result may be rendered as:

- a diagram through an adapter
- JSON context for an agent
- Markdown for a reviewer
- a traceability or conformance report

Generated diagrams are not canonical architecture. Adapter-specific layout and
rendering hints do not carry semantic authority.

The compiled `yarramate/graph/v2` representation is a normative,
version-scoped interchange contract with canonical JSON serialization.
Breaking structural or semantic changes require a new graph format version.
Compiled files remain derived and need not be committed.

The first projection query filters compiled concepts by document, globally
qualified kind, and operational lifecycle status. It may include relationships
whose endpoints are both selected. `yarramate ask --json` renders the closed
projection result as deterministic JSON for agents and CI.
Queries may also name an explicit portable set of globally qualified concept
subjects when a deliberately bounded context is required.
Queries may restrict relationships by globally qualified kind. A connected
relationship mode may include matching relationships incident to the initial
concept selection and add their opposite endpoints exactly one hop away. It
does not compute recursive reachability.
Kind selectors use exact globally qualified identity by default. A projection
may explicitly request descendant matching for both concept and relationship
kinds. Descendant matching uses resolved, versioned profile parent chains
provided as evaluation context; it does not add profile data to graph v2 or
silently broaden existing queries.
Queries may optionally exclude concepts that are not endpoints of a selected
relationship. Isolated concepts remain included by default; exclusion is a
deterministic selection operation, not an architectural-quality judgment.

YarraMate may ship optional native starter projections for recurring
architecture concerns. They are reusable queries, may legitimately be empty
in partial workspaces, and are neither mandatory completeness checks nor
claims of compatibility with an external viewpoint catalogue.

## Optional integrations

- LikeC4 is an authoring and visualization adapter.
- Graphify is an evidence and repository-analysis adapter.
- ArchiMate is an optional compatibility profile.

YarraMate Core must not depend on any of them.

The initial Graphify adapter consumes only explicitly mapped Graphify node
identities and emits a standard evidence overlay. A present mapped node is
confirmed; an absent mapped node is not observed. The adapter does not infer
native subjects or intent from Graphify labels, paths, communities, similarity,
or topology, and Core does not execute Graphify.

The LikeC4 export path consumes compiled projection results and an explicit
`likec4` subject mapping. Raw export emits one view; an adapter-owned project
definition may compose multiple projections into one deterministically
ordered logical model with independent views. It does not change graph v2,
interpret layout as semantics, import LikeC4, or promise round-tripping. Core
does not import the adapter module.
An adapter project may assign a renderer-specific view identity to a
projection. The generated ownership marker retains both identities, and the
override does not alter the projection result.
Every composed view retains the exact concept and relationship membership of
its source projection; a project-wide wildcard must not expose the unioned
model in each view.
The adapter may preserve selected compiled claims as flat LikeC4 metadata for
traceability; those fields remain derived and have no authority over the
native claims.
Compatibility between extensible semantic kinds and LikeC4 declaration kinds
uses a separate, versioned adapter-owned mapping. Transforming a presentation
kind never changes the globally qualified semantic kind retained in graph v2
and generated traceability metadata.
Self-contained projects validate resolved kinds against their bundled LikeC4
specification before writing; raw source export may target a separately
managed external specification.
The optional adapter exposes a non-writing check with a versioned
machine-readable result for CI and agents; this does not add adapter behavior
to Core. Adapter correctness diagnostics identify the authored value that can
repair the failure using a stable code, JSON Pointer, and one-based source
location.
The LikeC4 adapter may render a Core state comparison only when its projection
selects both ordered states. Change metadata, colors, and borders remain
derived adapter presentation and do not become graph claims. Generated-project
ownership includes the ordered comparison.
The adapter project may likewise order projected relationships as dynamic
steps or instantiate projected concepts into a closed deployment hierarchy.
Those declarations remain presentation hints and do not extend graph v2.

Optional adapter mappings are versioned companion documents outside Core.
They map globally qualified compiled native subject identities to opaque
external identities. Generic validation checks native existence, subject type,
and one-to-one identity; the named adapter validates its external side.
Mappings do not become claims and are not required for semantic completeness.

Optional evidence overlays evaluate existing globally qualified subjects or
stable claim IDs without changing native documents or graph v2. Controlled
results are provider observations, not approvals or automatic Core failures.
Provider locators remain opaque; independent observed claims require a
separate future contract.

Workspace reconciliation deterministically aggregates evidence reports,
summarizes confirmations, and emits contradicted, unknown, or unobserved
targets as review findings. It neither proposes replacement claims nor mutates
declared intent. Provider execution and remediation remain outside Core.

Native concepts may concisely declare a single accountable owner and multiple
identified constraint references. Both compile into explicit, globally
referenced claims. Core validates their deterministic structural correctness;
it does not infer approval authority, evaluate constraint satisfaction, or
judge architectural merit.

Native documents may optionally declare generic baseline, transition, and
target architecture states. Concepts and relationships retain one global
identity and use explicit presence claims rather than copied state models.
Operational lifecycle remains separate. Core validates state references,
acyclic ordering, and relationship endpoint presence, and produces
deterministic added/removed/retained comparisons; it does not define migration
workflow, state-specific claim values, or external-method conformance.

Constraint assessment reuses evidence overlays over stable constraint claim
IDs. Core does not contain a policy language, compliance engine, exception or
waiver workflow, missing-evidence policy, or automatic CI consequence.

Projection selectors are portable: well-formed selectors that do not match the
current graph produce no matches rather than correctness diagnostics. This
allows incremental adoption and reusable queries without introducing implicit
workspace dependencies.
