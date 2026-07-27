# Product roadmap

YarraMate grows by semantic depth and interoperability, not by accumulating
notation.

## 0.1 — Adapter-backed foundation

- Validate the initial vocabulary and relationship policies.
- Demonstrate cross-layer modelling through the LikeC4 adapter.
- Record the independent semantic and licensing boundary.
- Establish the tool-neutral product contract.

## 0.2 — Native document and compiler

- Define the versioned YAML format and normative JSON Schema. **Foundation
  implemented.**
- Define stable identities and concise claim syntax. **Initial concept and
  relationship syntax implemented.**
- Compile declared documents into a tool-neutral semantic graph. **Initial
  kind, descriptive, and relationship claims implemented.**
- Publish a typed library API and deterministic graph serialization.
  **`compileWorkspace` is exported through the typed package entrypoint with
  deterministic graph-v2 serialization.**
- Keep compiled artifacts reproducible and ignored by default.
- Publish a normative, canonical graph interchange contract. **Graph v2 JSON
  Schema, serializer, and `compile` CLI output implemented.**
- Maintain a canonical native model of the YarraMate repository. **Initial
  three-document self-model implemented and checked through the public
  compiler and CLI.**

## 0.3 — Core CLI and correctness

- Implement `init`, `add`, `connect`, `check`, `view`, and `context`.
  **The initial explicit-file command set is implemented. `add` and `connect`
  use validated writes and repeatable explicit workspace sources.**
- Validate schema, references, identifiers, kinds, endpoint compatibility,
  controlled fields, contradictions, and adapter mappings. **Core checks
  and optional subject-mapping integrity are implemented; contradiction
  coverage is deliberately incremental.**
- Emit stable, source-located, machine-readable diagnostics. **Implemented for
  `check --json`.**
- Keep completeness and organizational governance opt-in.

## 0.4 — Profiles and projections

- Publish the bundled YarraMate native vocabulary as a versioned profile.
  **Core is exposed as `yarramate/core@0.1` with qualified graph identities.**
- Support profiles with declared semantic parents and constraints. **Explicit
  profile documents, transitive inheritance, and constraint narrowing
  implemented.**
- Define projections as semantic queries with presentation hints.
  **Projection v1 supports document, qualified-kind, and lifecycle filters.**
- Render projection results for humans and agent harnesses. **Deterministic
  JSON context is implemented through `yarramate context`, with deterministic
  Markdown through `yarramate view`.**

## 0.5 — Optional adapters

- LikeC4 authoring, import/export, and visualization adapter.
  **A versioned subject-identity mapping seam and governed-change mapping are
  implemented; transformations and round-tripping remain future adapter work.**
- Generic evidence-provider interface.
- Graphify evidence and architecture-drift adapter.
- Additional authoring, catalogue, source, and runtime adapters.

## 0.6 — Compatibility

- Add independently governed mappings to external languages.
- Confirm licensing before distributing normative matrices or derivation rules.
- Version import/export behavior explicitly.
- Keep certification claims separate from technical interoperability.

## Decisions still required

- Public product name and trademark review.
- Repository licence, documentation licence, and contribution provenance.
- Automatic profile discovery and external registries.
- Controlled shorthand for ownership, constraints, and evidence. **Operational
  lifecycle status implemented.**
