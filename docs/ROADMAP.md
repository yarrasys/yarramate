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
  **`compileWorkspace` foundation implemented.**
- Keep compiled artifacts reproducible and ignored by default.

## 0.3 — Core CLI and correctness

- Implement `init`, `add`, `connect`, `check`, `view`, and `context`.
  **Explicit-file `check` implemented.**
- Validate schema, references, identifiers, kinds, endpoint compatibility,
  controlled fields, contradictions, and adapter mappings. **Core checks
  implemented except adapter mappings; contradiction coverage is deliberately
  incremental.**
- Emit stable, source-located, machine-readable diagnostics. **Implemented for
  `check --json`.**
- Keep completeness and organizational governance opt-in.

## 0.4 — Profiles and projections

- Publish the bundled YarraMate native vocabulary as a versioned profile.
- Support profiles with declared semantic parents and constraints.
- Define projections as semantic queries with presentation hints.
- Render projection results for humans and agent harnesses.

## 0.5 — Optional adapters

- LikeC4 authoring, import/export, and visualization adapter.
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
- Whether compiled artifacts receive a stable interchange schema in 0.x.
- Cross-document reference syntax and profile discovery.
- Controlled shorthand for ownership, status, constraints, and evidence.
