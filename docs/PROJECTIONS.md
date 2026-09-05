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
- `exclude` names subjects this query would otherwise select and the author
  has taken out: the exception a rule cannot state (#267,
  [ADR 0122](adr/0122-a-rule-can-name-its-exception.md)). It applies after
  every other facet AND after `connected` expansion, so an excluded subject is
  out whichever way it would have come back in, and relationships touching one
  are dropped with it. A relationship can be named too. Naming a subject no
  facet selects is allowed and inert until the model grows into the rule;
- `documents` filters canonical document IDs;
- `kinds` filters globally qualified concept kind identities;
- `kindMatching` is `exact` or `descendants` and defaults to `exact`;
- `owners` filters globally qualified owner subject identities;
- `constraints` filters globally qualified required-constraint identities;
- `relationshipKinds` filters relationships by globally qualified semantic
  kind identity without changing concept selection;
- `statuses` filters controlled lifecycle status;
- `excludeStatuses` drops concepts carrying one of the listed statuses while
  keeping concepts that declare no status at all — the viewpoint form of
  status filtering (`excludeStatuses: [retired]` shows the living
  architecture without dropping unstatused actors and motivation elements);
  it also vetoes `connected` expansion, so an excluded concept is never
  pulled in as a neighbour and edges touching one are dropped;
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

**Expansion follows relationships, and only relationships.** A subject that
another subject *references* — through `constraints[].ref` or
`references[].ref` — is not pulled in by `connected`, because a reference is a
pointer to a shared subject rather than an edge the ArchiMate table governs
and `check` validates. Widening the expansion to cover both would make the
neighbourhood of a heavily shared constraint include every concept that
references it, which is the unbounded result one hop exists to prevent
(#409).

This is worth knowing when choosing `connected`, because
`docs/MODEL-FLOOR.md` recommends turning a value that restricts into a
constraint subject referenced by many, and the shape it recommends is the
shape this expansion does not walk. A brief still *names* such a subject —
"Constrained by …" — so a reader learns it exists and can address it
directly; what they do not get is its kind, description, or its own
neighbours. A canvas has no prose in which to say the same thing, which is
why the visual editor's focus (#407) draws structure and not the answers
hanging off it.

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
contributes no matches and is not an evaluation error. This supports partial
models and reuse across repositories without weakening schema validation.
Explicit subjects are useful for deliberately bounded contexts that should
not expand merely because their source document gains another concept.

**Portability is about evaluation, and it is not a licence for a typo in your
own repository.** `check` resolves the selectors of every projection the
workspace manifest DECLARES, and refuses one naming something the model does
not have (YM921, ADR 0128). A mistyped state selects no state, which selects
no subject, which writes a clean empty artifact and exits 0; the failure is
silent and the artifact reaches whoever asked for it.

The two hold together because they are about different documents. A projection
in this workspace's manifest is this repository's own document and is checked
against this repository's model. A projection handed to `ask` or `export` as a
path, including one written for another repository, is evaluated and never
reference-checked, so it still degrades to no matches rather than to an error.

The check is referential, not emptiness. A query whose every name resolves and
which selects nothing is not refused: an architecture state nobody has
populated yet is empty, correctly.

`title` and `description` are presentation hints. They do not affect selection
or carry semantic authority.

`presentation.fold` says whether an editor draws this view's pattern instances
COLLAPSED by default — `instances`, or `none` which is the default and draws
everything ([ADR 0143](adr/0143-a-folded-instance-is-a-node-and-the-view-says-the-default.md)).
Like `nesting` and `direction` it is a hint about a first look, not a
restriction: a reader opens what they want, and nothing about selection
changes. Folding reads the same containment tree nesting does, so a view
declaring `fold: instances` without `assignment` in `nesting` collapses less
than its author probably expects; an editor says so rather than the loader
refusing it. See [docs/VISUAL-ADAPTER.md](VISUAL-ADAPTER.md) for what a folded
box draws.

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
automatically. `yarramate ask` renders the human brief by default, a compact
digest under `--budget`, and the projection result inside the deterministic
`yarramate/ask-result/v1` envelope under `--json`:

```sh
yarramate ask .yarramate/workspace.yaml \
  .yarramate/projections/current-engine.yaml --json
```

The same result renders as deterministic Markdown for reviewers:

```sh
yarramate export markdown .yarramate/projections/current-engine.yaml \
  .yarramate/workspace.yaml
```

JSON-context correctness failures emit the versioned
`yarramate/diagnostic-result/v1` contract.

Markdown lists selected concepts with their qualified kinds and lifecycle
status, followed by selected semantic relationships. It is generated output,
not a second source of architectural truth.

Projection documents are canonical queries, not canonical diagrams. Layout,
colors, coordinates, and renderer configuration belong to optional adapters.

## Next slice

During implementation, the whole workspace answers "which planned seam comes
first":

```sh
yarramate ask .yarramate/workspace.yaml --next
```

The report lists the workspace's `planned` subjects in dependency order —
prerequisites first, derived from the declared relationships between planned
subjects and each core kind's intent (ADR 0048) — with who requires each
subject and its evidence coverage, including `no evidence`. Dependency
cycles are appended sorted and marked instead of silently arranged. `--json`
emits the ordered subjects inside the deterministic
`yarramate/ask-result/v1` envelope. The exit status stays `0`
regardless of content: the next slice is a reading of declared intent, not a
gate.

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
documentation and do not reproduce the ArchiMate viewpoint catalogue.

Architecture-state authoring and comparison are described in
`docs/ARCHITECTURE-STATES.md`. The schemas are exported as `yarramate/schema/projection` and
`yarramate/schema/projection-result`.
