# Native document and compiler foundation

This document describes the first native YarraMate source format. The JSON
Schema at `schema/yarramate-document.schema.json` is normative for document
structure. Profile catalogues are normative for vocabulary.

## Authoring format

```yaml
format: yarramate/v1
id: checkout
profile: yarramate/core@0.1
concepts:
  - id: approve-order
    kind: capability
    name: Approve order
  - id: approval-api
    kind: applicationService
    name: Approval API
relationships:
  - id: api-realizes-approval
    kind: realization
    from: approval-api
    to: approve-order
```

The root and every authored record are closed objects. Version 1 has no generic
metadata field. A new semantic value must be introduced as defined syntax that
compiles to a claim, or by a versioned profile; adapter presentation belongs in
adapter configuration.

Optional concept `description` and relationship `name` fields compile into
explicit descriptive claims.

Concepts may also declare one optional `owner` reference:

```yaml
concepts:
  - id: payments-team
    kind: businessActor
    name: Payments team
  - id: payments-api
    kind: applicationService
    name: Payments API
    owner: payments-team
```

`owner` resolves locally or through a globally qualified `document#concept`
reference. It compiles to a stable `~owner` claim with predicate
`yarramate/ownership/owner`. The claim expresses accountable stewardship,
not approval authority or workflow. Core checks only that the subject exists.

A concept may require multiple explicitly identified constraints:

```yaml
concepts:
  - id: australia-only
    kind: constraint
    name: Customer data remains in Australia
  - id: customer-data
    kind: dataObject
    name: Customer data
    constraints:
      - id: residency
        ref: australia-only
```

Each entry compiles to `<subject>~constraint-<id>` with predicate
`yarramate/constraint/requires`. The authored ID keeps claim identity stable
when entries are reordered. Core checks that references resolve and IDs are
unique within the concept; it does not determine satisfaction, enforcement,
completeness, exceptions, or architectural merit.

Constraint satisfaction is assessed outside Core. Evidence providers may
evaluate the stable generated claim ID and report through an evidence overlay;
the observation does not mutate declared intent or become a Core validation
result.

Concepts and relationships may also declare an operational `status` of
`planned`, `current`, or `retired`. It compiles into a
`yarramate/lifecycle/status` claim. Status describes architecture lifecycle,
not review or approval; Git remains authoritative for governance.

Two relationship kinds have controlled concise fields:

```yaml
relationships:
  - id: reads-orders
    kind: access
    from: process
    to: orders
    mode: read
  - id: sends-orders
    kind: flow
    from: process
    to: next-process
    content: Orders
```

`mode` accepts `read`, `write`, `read-write`, or `unspecified` and is valid
only for `access`. `content` is non-empty text and is valid only for `flow`.
Both compile into claims about the relationship subject.

## Identity and references

Document IDs and local IDs use lowercase kebab case. A local ID is unique
across concepts and relationships in one document, and a document ID is unique
within the compiled workspace. A compiled subject ID is
`<document-id>#<local-id>`, so moving a file or reordering a YAML list does not
change semantic identity.

Relationship endpoints refer to concepts by local ID or by a qualified
`document-id#concept-id`. Local references resolve in the authored document;
qualified references resolve across all documents supplied to the workspace
compiler. File paths never participate in identity or resolution.
Relationship IDs are authored and stable.

Kind names are supplied by the selected explicit profile. The schema accepts a
kind string because profiles are extensible; compilation rejects a kind absent
from the selected catalogue.

## Compiled graph

`compileWorkspace(sources)` is the library interface. On success it returns a
`yarramate/graph/v2` value with:

- selected profile identifiers and source-document provenance;
- stable concept and relationship subjects;
- declared claims sorted by claim ID.

Graph v2 uses globally qualified kind identities. A Core concept kind compiles
as `yarramate/core@0.1#capability`; an extension kind uses its selected
profile identity. Relationship claims use the qualified relationship kind as
their predicate.

Concept authoring emits kind, name, and optional description claims.
Relationship authoring emits one semantic relationship claim plus an optional
name claim about the relationship subject. Every claim records its YAML pointer
and one-based source location.

Graph ordering is lexical and independent of workspace input order. Graph v2
is the version-scoped normative interchange contract defined in
`docs/SEMANTIC-GRAPH.md`; a breaking change requires a new graph format.

## Diagnostics

Diagnostics have stable codes, severity, message, source path, YAML pointer,
and one-based line and column.

| Range | Category | Initial codes |
| --- | --- | --- |
| `YM1xx` | YAML parsing | `YM101` malformed YAML |
| `YM2xx` | Document structure | `YM201` JSON Schema violation |
| `YM3xx` | Identity and references | `YM301` duplicate local ID; `YM302` unresolved concept reference; `YM303` duplicate document ID; `YM304` unresolved owner; `YM305` unresolved constraint; `YM306` duplicate constraint ID |
| `YM4xx` | Profile conformance | `YM401` unknown concept kind; `YM402` unknown relationship kind; `YM403` unavailable profile; `YM404` incompatible endpoint; `YM405` misplaced controlled field; `YM406` unavailable parent profile; `YM407`/`YM408` unavailable semantic parent; `YM409`/`YM410` inherited-name collision; `YM411` duplicate profile; `YM412` broadened constraint |
| `YM5xx` | Claim consistency | `YM501` competing whole-part claims |
| `YM6xx` | Adapter mapping integrity | `YM601` unknown native subject; `YM602` subject type mismatch; `YM603` duplicate native mapping; `YM604` duplicate external mapping; `YM605` duplicate versioned mapping |
| `YM7xx` | Workspace resolution | `YM701` unsafe pattern; `YM702` unmatched pattern; `YM703` cross-category file |
| `YM8xx` | Evidence integrity | `YM801` unknown subject; `YM802` unknown claim; `YM803` duplicate target; `YM804` duplicate evidence document |

Compilation returns no partial graph when an error diagnostic exists.
Diagnostic arrays are ordered by path, line, column, code, and message.

## Native conformance

The bundled profile applies its broad, original aspect restrictions to
relationship endpoints. For example, `assignment` requires an
active-structure source, `access` requires a passive-structure target,
`influence` requires a motivation target, and `triggering` connects behavior.
These are native YarraMate policies, not an external relationship matrix.

Declaring both `composition` and `aggregation` over the same ordered endpoints
is contradictory: one whole-part assertion cannot be both strong and weak.
This is the first deliberately narrow contradiction rule.

## Check CLI

```sh
yarramate check architecture.yaml
yarramate check architecture/*.yaml --json
```

Explicit files are checked as one workspace, so qualified references may cross
between them. Exit status is `0` when valid,
`1` for correctness diagnostics, and `2` for invocation or file errors.
`--json` emits a deterministic `yarramate/check-result/v1` object with `ok`
and `diagnostics`. Its normative structure is
`schema/yarramate-check-result.schema.json`, exported as
`yarramate/schema/check-result`. The command does not write compiled artifacts.

## Safe authoring CLI

```sh
yarramate init .
yarramate add architecture/main.yaml \
  --id order-approval --kind capability --name "Order approval"
yarramate connect architecture/main.yaml \
  --id api-realizes-approval --kind realization \
  --from approval-api --to order-approval
```

`init` creates `architecture/main.yaml` and `yarramate.workspace.yaml`, and
refuses to overwrite either. `add` appends a concept; `connect` appends a
relationship. Both preserve concise block-style YAML, compile the entire
candidate workspace in memory, and replace the target only when validation
succeeds. A rejected edit leaves the source byte-for-byte unchanged.

Optional `add` flags are `--status`, `--description`, `--owner <ref>`, and
repeatable `--constraint <id>=<ref>`. Optional `connect` flags are `--name`,
`--status`, `--mode`, and `--content`. Extension profiles and documents needed
for qualified references are passed explicitly using a repeatable
`--source <source.yaml>`:

```sh
yarramate add architecture/engine.yaml \
  --id compiler-worker --kind repository-file --name "Compiler worker" \
  --source profiles/yarramate-development.yaml \
  --source architecture/repository.yaml
```

This explicit input contract matches `compileWorkspace`; the authoring
commands do not search parent directories, infer a workspace, or fetch a
profile registry.

## Deliberate exclusions

This foundation does not define arbitrary properties, automatic profile or
repository discovery, remote registries, inferred claims, adapter execution
or round-tripping, constraint-policy execution, or governance workflow. These
require separate semantic decisions or later adapter and conformance work.
