# Architecture states

Architecture states are optional planning contexts for comparing a baseline,
one or more transitions, and a target without copying the native model or
overloading operational lifecycle.

## Authoring

A native document may declare states:

```yaml
states:
  - id: baseline
    kind: baseline
    name: Current architecture

  - id: migration
    kind: transition
    name: Migration plateau
    after: baseline

  - id: target
    kind: target
    name: Target architecture
    after: migration
```

`kind` is one of `baseline`, `transition`, or `target`. `after` is an optional
local or globally qualified architecture-state reference. Ordering must be
acyclic. Core does not require one state of each kind, require a linear plan,
or interpret ordering as approval or execution progress.

Concepts and relationships may declare where they are present:

```yaml
concepts:
  - id: shared-service
    kind: applicationComponent
    name: Shared service

  - id: legacy-service
    kind: applicationComponent
    name: Legacy service
    presentIn: [baseline, migration]

  - id: modern-service
    kind: applicationComponent
    name: Modern service
    presentIn: [migration, target]
```

An unscoped concept is present in every declared architecture state. An
unscoped relationship is present wherever both endpoint concepts are present.
An explicit relationship scope may narrow that inferred presence, but cannot
place the relationship in a state where either endpoint is absent. Authors
therefore annotate only subjects that vary.

Architecture states and lifecycle status are orthogonal. `planned`, `current`,
and `retired` remain operational lifecycle claims; baseline, transition, and
target are planning contexts.

## Graph v2 claims

Each state compiles as a globally qualified concept with Core `plateau` kind,
its authored name, `yarramate/state/type`, and optional
`yarramate/state/after` claim. `presentIn` entries compile to
`yarramate/state/present-in` reference claims.

Presence claim IDs encode the globally qualified state identity rather than a
file path or list position, so reordering authoring does not change identity.
The feature uses the existing graph-v2 subject and claim shape; it does not
introduce graph v3.

## Projection

The `states` projection selector accepts globally qualified state identities:

```yaml
query:
  states:
    - roadmap#target
  relationships: between
```

State selectors combine with other projection filters using logical AND.
Several state values combine with logical OR. State concepts themselves are
not included in a state-filtered result. Like other projection selectors, an
unavailable state is portable and produces no matches.

## Comparison

The typed `compareArchitectureStates(graph, from, to)` API and CLI classify
subjects as added, removed, or retained:

```sh
yarramate ask .yarramate/workspace.yaml \
  --compare roadmap#baseline roadmap#target
```

## Optional LikeC4 views

A normal state projection can be exported without any new native syntax:

```sh
yarramate-likec4 export-project \
  .yarramate/projections/state-engine-target.yaml \
  .yarramate/integrations/likec4/subject-mapping.yaml \
  .yarramate-out/state-target \
  --kinds .yarramate/integrations/likec4/kind-mapping.yaml \
  .yarramate/workspace.yaml
```

For a comparison view, the projection selects the union of both states and the
adapter receives their ordered comparison:

```sh
yarramate-likec4 export-project \
  .yarramate/projections/state-engine-change.yaml \
  .yarramate/integrations/likec4/subject-mapping.yaml \
  .yarramate-out/state-change \
  --compare yarramate-evolution#adapter-foundation \
    yarramate-evolution#state-foundation \
  --kinds .yarramate/integrations/likec4/kind-mapping.yaml \
  .yarramate/workspace.yaml
```

The adapter derives `yarramateChange` metadata and local concept styles from
Core's comparison result. Both states must appear in `query.states`; otherwise
the adapter reports `YMLC106`. An unknown compared state reports `YMLC105` at
its portable state selector. These are adapter correctness checks, not
architecture completeness or approval rules.

Colors and borders remain disposable LikeC4 presentation. Native documents,
graph v2, and the state-comparison result contain no renderer styling.

The comparison result conforms to
`schema/yarramate-state-comparison.schema.json` and uses format
`yarramate/state-comparison/v1`; `yarramate ask --compare --json` nests it
under a `comparison` key inside the `yarramate/ask-result/v1` envelope.
The result is a deterministic structural comparison, not an assessment,
migration plan, approval, or completeness claim.

## Deliberate boundary

This foundation does not allow names, kinds, owners, lifecycle values, or
other claim values to vary by state. Supporting state-scoped claims would
change claim interpretation and requires a separate graph-version decision.
It also does not implement a planning workflow, dates, work packages,
automatic transition derivation, or an external framework metamodel.
