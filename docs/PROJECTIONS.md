# Semantic projections

A projection is a versioned semantic query over graph v2 with optional
presentation hints. Its normative YAML structure is
`schema/yarramate-projection.schema.json`.

## Projection document

```yaml
format: yarramate/projection/v1
id: current-engine
version: "1.0"
query:
  subjects: [yarramate-engine#compiler]
  documents: [yarramate-engine]
  kinds: [yarramate/development@1.0#compiler-module]
  kindMatching: descendants
  owners: [yarramate-product#yarramate-maintainers]
  constraints: [yarramate-product#tool-neutral-core]
  relationshipKinds: [yarramate/core@0.1#realization]
  statuses: [current]
  states: [yarramate-evolution#state-foundation]
  relationships: connected
  isolatedConcepts: exclude
presentation:
  title: Current engine
```

Query fields combine with logical AND:

- `subjects` filters globally qualified concept subject identities;
- `documents` filters canonical document IDs;
- `kinds` filters globally qualified concept kind identities;
- `kindMatching` is `exact` or `descendants` and defaults to `exact`;
- `owners` filters globally qualified owner subject identities;
- `constraints` filters globally qualified required-constraint identities;
- `relationshipKinds` filters relationships by globally qualified semantic
  kind identity without changing concept selection;
- `statuses` filters controlled lifecycle status;
- `states` filters subject presence in globally qualified architecture states;
- `relationships` is `between`, `connected`, or `none` and defaults to
  `between`.
- `isolatedConcepts` is `include` or `exclude` and defaults to `include`.

Values within each filter list combine with logical OR; different fields
combine with logical AND. Concepts without the corresponding owner,
constraint, or status claim do not match that filter.

Kind selectors match exact globally qualified identities by default. With
`kindMatching: descendants`, both `kinds` and `relationshipKinds` also match
resolved semantic descendants declared through profile parent chains. This is
an explicit query choice: merely compiling with profiles never broadens an
existing projection. Missing selectors still match nothing.

With `relationships: between`, a relationship is selected only when both
semantic endpoint concepts are initially selected. With `connected`, a
matching relationship is selected when either endpoint is initially selected,
and its opposite endpoint is added to the result. Expansion is exactly one
hop: newly added endpoints do not trigger further selection. `none` excludes
all relationships.

`relationshipKinds` applies after concept selection and before relationship
mode evaluation. An unavailable qualified relationship kind selects no
relationships but does not remove otherwise matching concepts or produce a
diagnostic. Claims about excluded concepts and relationships are excluded.

With `isolatedConcepts: exclude`, concept subjects that are not an endpoint of
any selected relationship are removed after relationship selection. Every
selected relationship retains both endpoints. The option does not compute
reachability, infer importance, or diagnose an incomplete model. It is useful
for broad visual queries where an unconnected catalogue would obscure the
selected semantic neighbourhood. The default preserves isolated concepts,
including when no relationship matches.

For a state filter, unscoped concepts match every existing selected state.
Unscoped relationships follow their selected endpoints; explicitly scoped
relationships must also match the state. Architecture-state subjects are not
included in the result. An unavailable state selector produces no matches,
preserving portable projection behavior.

Owner and constraint claim objects retain their globally qualified references
even when a referenced concept is outside the selected documents or kinds.
Projection filters select result subjects; they do not silently expand the
query into a transitive reference closure.

Selectors are portable by default. A well-formed subject, document, kind,
owner, or constraint identity that is absent from the current graph
contributes no matches and is not a validation error. This supports partial
models and reuse across repositories without weakening schema validation.
Explicit subjects are useful for deliberately bounded contexts that should
not expand merely because their source document gains another concept.

`title` and `description` are presentation hints. They do not affect selection
or carry semantic authority.

## Result

Evaluation returns deterministic `yarramate/projection-result/v1` JSON with
the projection identity, optional presentation hints, contributing documents,
selected subjects, and selected claims. Its normative structure is
`schema/yarramate-projection-result.schema.json`.

The library exposes `loadProjection` and `evaluateProjection`.
`compileWorkspaceWithProfileContext` returns graph v2 plus an in-memory
resolved profile context for descendant-aware evaluation. The stable
`compileWorkspace` result and serialized graph v2 remain unchanged. If
`evaluateProjection` receives no profile context, matching remains exact even
when descendant matching is requested. The CLI supplies the resolved context
automatically and produces agent-ready JSON:

```sh
yarramate context .yarramate/projections/current-engine.yaml \
  .yarramate/workspace.yaml
```

The same result renders as deterministic Markdown for reviewers:

```sh
yarramate view .yarramate/projections/current-engine.yaml \
  .yarramate/workspace.yaml
```

JSON-context correctness failures emit the versioned
`yarramate/diagnostic-result/v1` contract.

Markdown lists selected concepts with their qualified kinds and lifecycle
status, followed by selected semantic relationships. It is generated output,
not a second source of architectural truth.

Projection documents are canonical queries, not canonical diagrams. Layout,
colors, coordinates, and renderer configuration belong to optional adapters.

## Native starter views

The dogfooding workspace supplies eight optional projection templates:

- architecture landscape;
- motivation and outcomes;
- strategy and capabilities;
- business operation;
- application cooperation;
- information structure;
- technology and deployment;
- implementation roadmap.

They use original YarraMate query definitions, tolerate partial adoption, and
may produce an empty view when a workspace has no matching concepts. Broad
starter views may exclude isolated concepts to keep diagrams readable; sparse
business and roadmap views retain them. The views are not mandatory
documentation and do not reproduce or claim conformance with an external
viewpoint catalogue.

Architecture-state authoring and comparison are described in
`docs/ARCHITECTURE-STATES.md`. The schemas are exported as `yarramate/schema/projection` and
`yarramate/schema/projection-result`.
