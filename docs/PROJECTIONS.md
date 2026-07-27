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
  documents: [yarramate-engine]
  kinds: [yarramate/development@1.0#compiler-module]
  statuses: [current]
  relationships: between
presentation:
  title: Current engine
```

Query fields combine with logical AND:

- `documents` filters canonical document IDs;
- `kinds` filters globally qualified concept kind identities;
- `statuses` filters controlled lifecycle status;
- `relationships` is `between` or `none` and defaults to `between`.

Concepts without a status claim do not match a status filter. With
`relationships: between`, a relationship is selected only when both semantic
endpoint concepts are selected. Claims about excluded concepts and
relationships are excluded as well.

`title` and `description` are presentation hints. They do not affect selection
or carry semantic authority.

## Result

Evaluation returns deterministic `yarramate/projection-result/v1` JSON with
the projection identity, optional presentation hints, contributing documents,
selected subjects, and the closed set of selected claims.

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

Markdown lists selected concepts with their qualified kinds and lifecycle
status, followed by selected semantic relationships. It is generated output,
not a second source of architectural truth.

Projection documents are canonical queries, not canonical diagrams. Layout,
colors, coordinates, and renderer configuration belong to optional adapters.
