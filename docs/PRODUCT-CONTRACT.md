# YarraMate product contract

This document records the foundational decisions agreed before implementation
of the native conformance engine.

## Definition

YarraMate is an open-source semantic architecture engine and guided
methodology. It owns a tool-neutral semantic graph, validates architectural
claims and rules, generates task-specific context and projections, and
supports incremental solution design through human and agent interfaces.

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
constraint, and evidence are claims.

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
yarramate add
yarramate connect
yarramate check
yarramate compile
yarramate view
yarramate context
yarramate evidence
```

Machine-readable checking uses the versioned
`yarramate/check-result/v1` contract. It reports deterministic correctness
diagnostics only; it is not an approval, completeness, or quality score.
Other JSON-producing semantic commands report correctness failures through
the versioned `yarramate/diagnostic-result/v1` contract.

A versioned workspace manifest may explicitly enumerate local documents,
profiles, projections, and adapter mappings. Paths resolve relative to the
manifest with deterministic, traversal-safe glob expansion. The CLI never
searches parent directories for a manifest or infers governance from it.

## Validation

Core `yarramate check` enforces correctness:

- document schema validity
- unique and stable identifiers
- valid concept and relationship kinds
- resolvable references
- relationship endpoint compatibility
- required fields for selected kinds
- controlled metadata values
- absence of contradictory declared claims
- adapter mapping integrity

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
whose endpoints are both selected. `yarramate context` renders the closed
projection result as deterministic JSON for agents and CI.
Queries may also name an explicit portable set of globally qualified concept
subjects when a deliberately bounded context is required.

## Optional integrations

- LikeC4 is an authoring and visualization adapter.
- Graphify is an evidence and repository-analysis adapter.
- ArchiMate is an optional compatibility profile.

YarraMate Core must not depend on any of them.

The first LikeC4 export path consumes a compiled projection result and an
explicit `likec4` subject mapping. It emits deterministically ordered logical
model elements, typed relationships, and one element view. It does not change
graph v2, interpret layout as semantics, import LikeC4, or promise
round-tripping. Core does not import the adapter module.
The adapter may preserve selected compiled claims as flat LikeC4 metadata for
traceability; those fields remain derived and have no authority over the
native claims.

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

Native concepts may concisely declare a single accountable owner and multiple
identified constraint references. Both compile into explicit, globally
referenced claims. Core validates their deterministic structural correctness;
it does not infer approval authority, evaluate constraint satisfaction, or
judge architectural merit.

Constraint assessment reuses evidence overlays over stable constraint claim
IDs. Core does not contain a policy language, compliance engine, exception or
waiver workflow, missing-evidence policy, or automatic CI consequence.

Projection selectors are portable: well-formed selectors that do not match the
current graph produce no matches rather than correctness diagnostics. This
allows incremental adoption and reusable queries without introducing implicit
workspace dependencies.
