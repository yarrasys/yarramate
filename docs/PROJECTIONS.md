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
  owners: [yarramate-product#yarramate-maintainers]
  constraints: [yarramate-product#tool-neutral-core]
  statuses: [current]
  relationships: between
presentation:
  title: Current engine
```

Query fields combine with logical AND:

- `subjects` filters globally qualified concept subject identities;
- `documents` filters canonical document IDs;
- `kinds` filters globally qualified concept kind identities;
- `owners` filters globally qualified owner subject identities;
- `constraints` filters globally qualified required-constraint identities;
- `statuses` filters controlled lifecycle status;
- `relationships` is `between` or `none` and defaults to `between`.

Values within each filter list combine with logical OR; different fields
combine with logical AND. Concepts without the corresponding owner,
constraint, or status claim do not match that filter. With
`relationships: between`, a relationship is selected only when both semantic
endpoint concepts are selected. Claims about excluded concepts and
relationships are excluded as well.

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

The library exposes `loadProjection` and `evaluateProjection`. The CLI produces
agent-ready JSON:

```sh
yarramate context projections/current-engine.yaml \
  profiles/yarramate-development.yaml \
  architecture/product.yaml \
  architecture/engine.yaml \
  architecture/repository.yaml
```

The same result renders as deterministic Markdown for reviewers:

```sh
yarramate view projections/current-engine.yaml \
  profiles/yarramate-development.yaml \
  architecture/product.yaml \
  architecture/engine.yaml \
  architecture/repository.yaml
```

JSON-context correctness failures emit the versioned
`yarramate/diagnostic-result/v1` contract.

Markdown lists selected concepts with their qualified kinds and lifecycle
status, followed by selected semantic relationships. It is generated output,
not a second source of architectural truth.

Projection documents are canonical queries, not canonical diagrams. Layout,
colors, coordinates, and renderer configuration belong to optional adapters.

The schemas are exported as `yarramate/schema/projection` and
`yarramate/schema/projection-result`.
