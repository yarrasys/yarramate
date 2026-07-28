# Optional adapter mappings

Adapter mappings connect canonical native YarraMate subjects to identities
owned by an external tool. Their normative structure is
`schema/yarramate-adapter-mapping.schema.json`.

```yaml
format: yarramate/adapter-mapping/v1
id: governed-change-likec4
version: "1.0"
adapter: likec4
mappings:
  - native: governed-change#control-plane
    external: controlPlane
    type: concept
```

`native` is always a globally qualified compiled subject identity:
`<document-id>#<local-id>`. File paths and local-only references are not
accepted. `external` is an opaque, non-empty identity interpreted by the named
adapter. `type` is `concept` or `relationship`.

The generic mapping validator checks deterministic tool-neutral integrity:

- the native subject exists in the compiled graph;
- its compiled subject type matches the declaration;
- a native subject occurs at most once in a mapping document;
- an external identity occurs at most once in a mapping document.

Across all mapping documents checked together, versioned mapping identities
are unique. Native and external identities remain one-to-one within the scope
of one named adapter; the same native subject may be mapped independently by
different adapters.

These are correctness checks, not completeness checks. Native subjects need
not all be mapped. The generic validator does not interpret or validate an
external identity; the named adapter owns that check against its external
model or catalogue.

Mappings are optional companion documents. They never become native semantic
claims, and `compileWorkspace` does not load or depend on them. The stable
`check` CLI orchestrates the optional layer:

```sh
yarramate check .yarramate/workspace.yaml
```

The typed package API exposes `loadAdapterMapping`, `validateAdapterMapping`,
and workspace-level `validateAdapterMappings` for adapter implementations and
agent harnesses.
Successful loads normalize mapping entry order by native identity, external
identity, and type.

The LikeC4 adapter can add missing entries without replacing existing external
identities:

```sh
yarramate-likec4 map --sync \
  .yarramate/integrations/likec4/subject-mapping.yaml \
  .yarramate/workspace.yaml
```

The command compiles the explicit workspace, validates the existing mapping,
then appends only unmapped concepts and relationships. Architecture-state
planning subjects are excluded. External identities use deterministic
lower-camel local IDs; collisions receive a document prefix and, only when
still necessary, a numeric suffix. Existing mappings and their authored
overrides are preserved. The candidate mapping is validated before an atomic
replacement, and a second sync is a no-op.

The governed-change test fixture has a native document and explicit mapping:

```sh
node dist/cli.js check \
  test/fixtures/valid/governed-change.workspace.yaml
```

Relationship mappings are supported, but the fixture deliberately maps only
concepts because its current LikeC4 relationship declarations do not carry
authored stable identities. YarraMate does not invent position-derived
external relationship identities.

## LikeC4 export

The optional adapter has its own binary and package subpath:

```sh
yarramate-likec4 export-project \
  test/fixtures/valid/governed-change.projection.yaml \
  test/fixtures/valid/governed-change.likec4-mapping.yaml \
  .yarramate-out/governed-change-fixture \
  test/fixtures/valid/governed-change.workspace.yaml
```

The same typed seam is exported from `yarramate/adapter/likec4` as
`exportLikeC4`. Its inputs are a closed projection result and one mapping; its
output is deterministic LikeC4 source or sorted adapter diagnostics.
CLI failures use the closed
`yarramate/likec4-diagnostic-result/v1` envelope.
Adapter diagnostics use the same `severity`, `path`, JSON Pointer, and
one-based line and column fields as Core diagnostics. The location identifies
the authored value that can correct the failure:

| Code | Meaning | Location |
| --- | --- | --- |
| `YMLC101` | The subject mapping targets another adapter. | Subject mapping `adapter`. |
| `YMLC102` | A projected concept has no LikeC4 identity. | Native concept `kind`. |
| `YMLC103` | A mapped LikeC4 identity is not a valid identifier. | Subject mapping `external`. |
| `YMLC104` | A resolved kind is absent from the bundled specification. | Kind mapping `external`, or the native kind when no mapping exists. |
| `YMLC105` | A compared architecture state is absent from the graph. | Projection state selector. |
| `YMLC106` | A compared state is omitted from the projection query. | Projection `states` array. |
| `YMLC107` | Two project entries resolve to the same LikeC4 view identity. | Duplicate project view `id`, or `projection` when no override is present. |
| `YMLC108` | A dynamic step does not select a relationship. | Project dynamic-step relationship. |
| `YMLC109` | A deployment identity, parent, or projected subject is invalid. | The corresponding project deployment field. |
| `YMLC110` | A project mapping, kind mapping, or projection is missing or unreadable. | The referencing project field. |

Schema and source parsing failures retain their existing Core diagnostic
codes in the same envelope. Mixed Core and adapter failures use the shared
deterministic path, line, column, code, and message ordering.

For callers starting with source documents, `prepareLikeC4Export` is the deep
adapter seam. One call compiles the workspace, loads and evaluates the
projection, loads and validates subject and optional kind mappings, enforces
either the bundled or consumer-managed vocabulary contract, and renders the
source. It supplies resolved profile context when a projection explicitly
requests descendant kind matching. That context is tool-neutral and
in-memory; it is not an adapter field or graph v2 extension. The operation
returns no partial success state.

Every projected concept must have a valid LikeC4 identifier in the mapping.
Relationship declarations use mapped endpoint identities and the terminal
identifier of each globally qualified relationship kind. Relationships do not
need mappings because this export does not manufacture external relationship
identities.

Generated elements and relationships carry their globally qualified native
identity and semantic kind as `metadata.yarramateId` and
`metadata.yarramateKind`. When selected claims exist, the adapter also emits
flat `status`, `owner`, `constraints`, `references`, `mode`, and `content`
metadata. Native descriptions become LikeC4 element or relationship
descriptions. These values preserve traceability and filtering context; they
do not make LikeC4 canonical. Projection title and description hints become
view properties.

When a projected relationship is used as a dynamic step, its native
description is also presented on that step. Step ordering and any title
override remain adapter presentation.

Raw projection export emits a flat logical model and one ordinary element
view. It does not emit deployments, dynamic views, imports, or layout state,
and it does not import or round-trip LikeC4.
Project export may add adapter-owned dynamic views as described below.

`export-project` writes `model.likec4`, `specification.likec4`, and
`likec4.config.json` into a project directory, plus a versioned
`yarramate.generated.json` marker. A matching marker permits deterministic
regeneration of only those three declared files and preserves unrelated
files. The complete marker is validated against its normative schema before
ownership is trusted; unmarked, malformed, or differently owned directories
are refused. The project directory, marker, and three owned files must also be
physical directories/files rather than symbolic links or substituted file
types, preventing regeneration from writing outside the marked project. The
marker records SHA-256 digests for all three owned files. Once digests are
present, any edit, deletion, or interrupted partial update is refused instead
of silently overwritten; deleting the derived project and exporting it again
is the recovery path. Regeneration stages every owned file in the destination
directory, atomically replaces each complete file, and replaces the ownership
marker last. A process interruption can therefore leave old and new complete
files, but never a partially written file; the still-current marker digests
make that mixed state detectable on the next run. Legacy v1 markers without
digests are accepted once and upgraded on regeneration. Single-view marker v1
is defined by `schema/yarramate-likec4-generated-project.schema.json`.

For a multi-view project, pass an adapter-owned project definition in place of
the projection and mapping arguments:

```yaml
format: yarramate/likec4-project/v1
id: yarramate
version: "1.0"
title: YarraMate architecture
mapping: .yarramate/integrations/likec4/subject-mapping.yaml
kindMapping: .yarramate/integrations/likec4/kind-mapping.yaml
views:
  - id: index
    projection: .yarramate/projections/starter-landscape.yaml
  - projection: .yarramate/projections/likec4-export-path.yaml
  - projection: .yarramate/projections/state-engine-change.yaml
    compare:
      from: yarramate-evolution#adapter-foundation
      to: yarramate-evolution#state-foundation
```

```sh
yarramate-likec4 export-project \
  .yarramate/integrations/likec4/project.yaml \
  .yarramate-out/likec4 \
  .yarramate/workspace.yaml
```

Every `mapping`, `kindMapping`, and `views[].projection` path in a LikeC4
project definition is repository-relative: it resolves from the CLI working
directory, normally the repository root, not from the project-definition
file. Absolute paths, backslashes, and `..` traversal are rejected so the
project cannot escape that explicit root.

The adapter unions mapped subjects and claims into one `model` block, then
emits one ordinary LikeC4 view per projection. This avoids duplicate
declarations without copying or weakening the semantic queries. Project
entries may supply an adapter-owned `id` override without changing the native
projection identity. Using `id: index` on a curated landscape prevents LikeC4
from synthesizing a landing view over the entire unioned model. The generated
ownership marker records both the override and projection identity.
Project definition and generated marker v2 schemas are
`schema/yarramate-likec4-project.schema.json` and
`schema/yarramate-likec4-generated-project-v2.schema.json`. The lower-level
`export` command still writes one projection's model source to stdout.

## LikeC4 kind compatibility

Extensible semantic profiles may declare kinds that the bundled LikeC4
specification does not know. A separate adapter-owned companion document maps
those semantic kinds deliberately:

```yaml
format: yarramate/likec4-kind-mapping/v1
id: yarramate-development-likec4
version: "1.0"
conceptKinds:
  - native: yarramate/development@1.0#repository-file
    external: artifact
relationshipKinds:
  - native: yarramate/development@1.0#implements
    external: realization
```

Pass it with `--kinds` to either LikeC4 export command. Native sides are
globally qualified semantic kind identities and external sides are LikeC4
identifiers. Each native kind may occur once per category, while multiple
native kinds may intentionally collapse to one external presentation kind.
Unmapped kinds retain their terminal identifier. The normative schema is
`schema/yarramate-likec4-kind-mapping.schema.json`.

The non-writing adapter check runs the same compile, projection, subject
mapping, kind mapping, bundled-vocabulary, and in-memory rendering path used
by project export:

```sh
yarramate-likec4 check \
  .yarramate/projections/likec4-export-path.yaml \
  .yarramate/integrations/likec4/subject-mapping.yaml \
  --kinds .yarramate/integrations/likec4/kind-mapping.yaml \
  .yarramate/workspace.yaml
```

It is the stable CI seam when no derived project should be written.
With `--json`, both successful and failing checks emit the closed
`yarramate/likec4-check-result/v1` contract instead of requiring consumers to
parse prose or switch result shapes.

Raw `export` leaves vocabulary ownership with the consuming LikeC4 project and
therefore permits custom declaration kinds. `export-project` uses YarraMate's
bundled specification, so it checks every resolved external kind against that
catalogue before creating or updating a directory. Unsupported or unmapped
extension kinds fail with `YMLC104` rather than leaving a project that only
fails later in the editor. When an explicit kind mapping caused the
incompatibility, the diagnostic points to its `external` field rather than the
native document.

## Architecture-state comparison presentation

`--compare <from-state> <to-state>` asks the adapter to render Core's
deterministic comparison over a projection that selects both states:

```sh
yarramate-likec4 check \
  .yarramate/projections/state-engine-change.yaml \
  .yarramate/integrations/likec4/subject-mapping.yaml \
  --compare yarramate-evolution#adapter-foundation \
    yarramate-evolution#state-foundation \
  --kinds .yarramate/integrations/likec4/kind-mapping.yaml \
  .yarramate/workspace.yaml
```

Each projected subject receives flat `yarramateChange` metadata. The generated
view styles added concepts green, removed concepts red with dashed borders,
and retained concepts gray. Relationship classifications are retained as
metadata without inventing LikeC4 relationship identities.

Both comparison states must occur in the projection's `query.states`.
`YMLC105` identifies a selected comparison state missing from the compiled
workspace, and `YMLC106` identifies a compared state omitted from the
projection. A generated project marker owns the ordered comparison in addition
to its projection and mappings, preventing a directory from silently changing
comparison meaning on regeneration.

In a multi-view project, direct comparison styles remain local to the selected
view and marker v2 records its ordered comparison. Because model elements are
shared by every view, view-specific `yarramateChange` metadata is not placed on
the shared declarations.

## Dynamic-view presentation

A project view may declare adapter-owned dynamic steps:

```yaml
views:
  - id: request-flow
    projection: .yarramate/projections/request-flow.yaml
    dynamic:
      steps:
        - relationship: checkout#client-calls-api
          title: submits request
        - relationship: checkout#api-reads-orders
```

Every step must name a relationship selected by that view's projection.
Endpoints and the default displayed relationship name come from compiled
claims. Step order and title overrides are presentation hints; they do not
become native claims or alter graph v2.

## Deployment-view presentation

A project view may instantiate projected concepts into adapter-owned
deployment nodes:

```yaml
views:
  - id: production
    projection: .yarramate/projections/runtime.yaml
    deployment:
      nodes:
        - id: production
          kind: environment
          name: Production
        - id: app-host
          kind: host
          name: Application host
          parent: production
      instances:
        - id: api
          subject: checkout#api
          node: app-host
```

The available node kinds are `environment`, `zone`, `host`, and `runtime`.
Node parents must exist and form an acyclic hierarchy. Instance IDs are named
explicitly, their nodes must exist, and their subjects must be concepts
selected by the view projection. The topology remains adapter presentation
rather than native deployment claims.
