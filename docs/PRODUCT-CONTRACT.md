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

The first native format uses closed YAML records for concepts and
relationships and deliberately has no generic metadata bag. Document-local
authored IDs compile under a stable document namespace; source file paths and
list positions are not semantic identity. JSON Schema governs structure while
the selected versioned profile governs valid vocabulary.

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
yarramate view
yarramate context
```

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

## Projections

A projection is a versioned semantic query plus optional presentation hints.
Its result may be rendered as:

- a diagram through an adapter
- JSON context for an agent
- Markdown for a reviewer
- a traceability or conformance report

Generated diagrams are not canonical architecture. Adapter-specific layout and
rendering hints do not carry semantic authority.

## Optional integrations

- LikeC4 is an authoring and visualization adapter.
- Graphify is an evidence and repository-analysis adapter.
- ArchiMate is an optional compatibility profile.

YarraMate Core must not depend on any of them.
