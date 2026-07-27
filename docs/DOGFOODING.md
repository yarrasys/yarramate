# Modelling YarraMate with YarraMate

The `architecture` directory contains the canonical native architecture model
for this repository:

- `product.yaml` — product goals, requirements, and capabilities;
- `engine.yaml` — compiler, CLI, behavior, and semantic data;
- `repository.yaml` — contracts, decisions, roadmap, and adapter prototype.

The documents use qualified references and the bundled
`yarramate/core@0.1` profile. The engine document selects the explicit
`yarramate/development@1.0` profile from
`profiles/yarramate-development.yaml`, dogfooding extension kinds and inherited
Core semantics.

The model currently covers:

- product goals and authoritative requirements;
- compilation, validation, and machine-context capabilities;
- compiler, CLI, profile catalogue, and optional LikeC4 prototype;
- parse, validation, compilation, and check behavior;
- safe `init`, `add`, and `connect` authoring behavior;
- optional adapter subject-mapping validation;
- canonical graph-v2 serialization and schema conformance;
- schemas, catalogues, native documents, diagnostics, and semantic graphs;
- the product contract, ADR collection, and roadmap.

It is checked through the same compiler and CLI exposed to users:

```sh
pnpm self:check
```

The regression test in `test/self-model.test.ts` also compiles the model through
the public library interface.

## Observed semantic friction

The first self-model did not require a new concept or relationship kind. It did
expose missing semantics that should inform later slices:

- The LikeC4 prototype can be associated with native authoring, but adapter
  mappings are not represented or validated.
- Ownership, evidence, decisions, and constraints have no controlled concise
  syntax yet.

Qualified cross-document references were implemented directly from the first
observation and now keep the three semantic areas independently reviewable.
Controlled operational lifecycle status now marks implemented capabilities and
engine concepts as `current` without introducing an approval workflow.
Canonical product and current-engine projections now generate focused JSON
context directly from the three-document graph.
Repository files that need identity are modelled as first-class
`repository-file` concepts in the development profile. The implementation
traceability projection connects them to engine concepts without introducing a
generic path metadata field.
The self-model now includes the safe authoring services and their CLI
regression tests. Their explicit-source contract was derived from using an
extension profile and qualified cross-document references in this repository.
The governed-change example is now authored canonically as native YAML and
uses a separate LikeC4 subject mapping. Only stable LikeC4 concept identities
are mapped; relationship identities are not fabricated from source position.
The repository model compiles through `self:compile` to the same normative
graph-v2 JSON consumed by projections and adapter mapping validation.
The remaining gaps are observations, not permission to add generic metadata.
Each requires explicit claim syntax, profile semantics, or an adapter contract.
