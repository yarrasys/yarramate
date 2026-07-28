# Product roadmap

YarraMate grows by semantic depth and interoperability, not by accumulating
notation.

## Target product journeys

- **Discover an existing project** through an agent harness, producing
  evidence-backed native-document proposals, focused views, and reconciliation
  findings for Git review.
- **Design a new solution before building it** through a guided agent
  methodology, producing intentional native architecture, alternatives, and
  bounded implementation context.
- Use the same CLI, native documents, semantic graph, profiles, and projections
  for both journeys. Do not create a separate agent service or discovered-model
  authority.

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
- Keep compiled artifacts reproducible and ignored by default. **Canonical
  serializers are deterministic and `dist/` remains ignored.**
- Publish a normative, canonical graph interchange contract. **Graph v2 JSON
  Schema, serializer, and `compile` CLI output implemented.**
- Maintain a canonical native model of the YarraMate repository. **Initial
  three-document self-model implemented and checked through the public
  compiler and CLI.**

## 0.3 — Core CLI and correctness

- Implement `init`, `add`, `connect`, `check`, `view`, and `context`.
  **The initial explicit-file command set is implemented. `add` and `connect`
  use validated writes and repeatable explicit workspace sources.**
- Define deterministic workspace input configuration. **Versioned explicit
  manifests, safe glob resolution, CLI consumption, and dogfooding
  implemented.**
- Validate schema, references, identifiers, kinds, endpoint compatibility,
  controlled fields, contradictions, and adapter mappings. **Core checks
  and optional subject-mapping integrity are implemented. Whole-part
  contradictions are checked workspace-wide with architecture-state
  applicability; additional contradiction coverage remains deliberately
  incremental.**
- Emit stable, source-located, machine-readable diagnostics. **Implemented as
  the normative `yarramate/check-result/v1` contract for `check --json`.**
- Keep completeness and organizational governance opt-in.

## 0.4 — Profiles and projections

- Publish the bundled YarraMate native vocabulary as a versioned profile.
  **Core is exposed as `yarramate/core@0.1` with qualified graph identities.**
- Support profiles with declared semantic parents and constraints. **Explicit
  profile documents, transitive inheritance, and constraint narrowing
  implemented.**
- Define projections as semantic queries with presentation hints.
  **Document, kind, lifecycle-status, owner, required-constraint, and
  explicit-subject, qualified relationship-kind, and bounded one-hop
  relationship-inclusion queries are implemented, together with optional
  deterministic isolated-concept exclusion and opt-in descendant matching
  over resolved profile ancestry.**
- Render projection results for humans and agent harnesses. **Deterministic
  JSON context is implemented through `yarramate context`, with deterministic
  Markdown through `yarramate view`.**
- Supply an optional native starter view pack. **Eight original concern-based
  projections are dogfooded in one unified LikeC4 project; unmatched templates
  remain valid and impose no completeness requirement.**
- Represent optional baseline, transition, and target planning contexts.
  **Architecture-state declarations, concise subject presence, state-filtered
  projections, deterministic comparisons, and repository dogfooding are
  implemented without changing graph v2. State-scoped claim values remain a
  future graph-version decision.**

## 0.5 — Agent journeys

- Publish a tool-neutral YarraMate agent skill that orchestrates only stable
  CLI and schema contracts. **The first portable
  `skills/yarramate-architecture` workflow is implemented and validated.**
- Implement a smallest useful `discover` workflow: orient to a repository,
  gather evidence, propose native documents, check them, and render reviewable
  projections. **An executable existing-project fixture validates the native
  proposal, evidence overlay, and focused context through the CLI.**
- Implement a smallest useful `design` workflow: capture drivers and
  constraints, explore alternatives, declare a target solution, check it, and
  provide bounded context before implementation. **An executable greenfield
  fixture validates alternatives, target context, and state comparison.**
- Implement deterministic reconciliation between declared subjects or claims
  and provider observations without allowing evidence to mutate intent.
  **The discovery journey evaluates its proposal through provider-neutral
  evidence reports and aggregates unresolved observations through the
  normative workspace reconciliation report. Provider execution and richer
  drift proposal generation remain adapter work.**
- Define repeatable journey fixtures and acceptance scenarios usable across
  Codex, Claude Code, and other agent harnesses. **Both journeys have literal
  CLI acceptance fixtures and the shared skill has been independently
  forward-tested on clean temporary projects.**
- Prove consumer portability from a packed artifact. **The package now has an
  explicit runtime/schema/skill boundary; a clean consumer contract invokes
  both installed CLI binaries, all journey primitives, schema and skill
  exports, and thin Codex/Claude links without repository source paths.**

## 0.6 — Optional adapters

- LikeC4 authoring, import/export, and visualization adapter.
  **A versioned subject-identity mapping seam, deterministic
  projection-to-LikeC4 export, self-contained project materialization, adapter
  CLI with a source-located non-writing check, explicit kind-compatibility
  mapping, one-model multi-view project composition, state-specific and
  comparison visualization, explicit per-view membership after model union,
  ordered dynamic views over projected relationship subjects, and
  regression-fixture and self-dogfooding mappings are implemented. Import,
  round-tripping and general styling parity remain future adapter work.
  Adapter-owned deployment nodes and named instances of projected concepts
  are implemented with regression validation.**
- Generic evidence-provider interface.
  **A provider-neutral existing-claim evidence overlay and deterministic report
  are implemented. Constraint assessment reuses that seam; the first optional
  provider execution emits ordinary overlays from explicit Graphify node
  mappings. CI policy remains consumer work.**
- Graphify evidence and architecture-drift adapter.
  **Initial explicit concept-subject observation is implemented without
  inference or a Core dependency. Provider-driven proposal generation,
  relationship observation, and richer drift interpretation remain future
  adapter work pending stable external identities and semantics.**
- Additional authoring, catalogue, source, and runtime adapters.

## 0.7 — Compatibility

- Add independently governed mappings to external languages.
- Confirm licensing before distributing normative matrices or derivation rules.
- Version import/export behavior explicitly.
- Keep certification claims separate from technical interoperability.

## Core 0.1 release contract

- Publish a machine-readable boundary for stable Core formats and commands.
  **Implemented through `yarramate/core-contract/v1`, the native Core 0.1
  manifest, declared-format and package-surface verification in `check`, and
  repository dogfooding.**
- Keep adapter formats and external certification outside the Core contract.
  **The Core 0.1 manifest contains no LikeC4 or external-language formats and
  records controlled exclusions explicitly.**

## Decisions still required

- Automatic profile discovery and external registries.
  **Local explicit manifests are implemented; automatic discovery and remote
  registries remain intentionally unresolved.**

Publication preparation uses the YarraMate name at
`github.com/yarrasys/yarramate`, licenses the repository under MIT, and accepts
ordinary pull requests without a CLA, DCO, or sign-off requirement.

## Backlog disposition

All concrete work in the agreed Core 0.1 and initial journey scope is
implemented. Remaining future statements are decision-gated, externally
blocked, or demand-gated rather than locally executable backlog. See
`docs/BACKLOG-DISPOSITION.md` for the explicit gates.
