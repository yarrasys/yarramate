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

Relationship endpoints refer to concepts by local ID. Relationship IDs are
authored and stable. Cross-document references are not part of version 1; they
will be designed with workspace/profile loading rather than inferred from file
paths.

Kind names are supplied by the selected explicit profile. The schema accepts a
kind string because profiles are extensible; compilation rejects a kind absent
from the selected catalogue.

## Compiled graph

`compileWorkspace(sources)` is the library interface. On success it returns a
`yarramate/graph/v1` value with:

- selected profile identifiers and source-document provenance;
- stable concept and relationship subjects;
- declared claims sorted by claim ID.

Concept authoring emits kind, name, and optional description claims.
Relationship authoring emits one semantic relationship claim plus an optional
name claim about the relationship subject. Every claim records its YAML pointer
and one-based source location.

Graph ordering is lexical and independent of workspace input order. The graph
format is a deterministic 0.x compiler result, not yet a promised long-term
interchange schema.

## Diagnostics

Diagnostics have stable codes, severity, message, source path, YAML pointer,
and one-based line and column.

| Range | Category | Initial codes |
| --- | --- | --- |
| `YM1xx` | YAML parsing | `YM101` malformed YAML |
| `YM2xx` | Document structure | `YM201` JSON Schema violation |
| `YM3xx` | Identity and references | `YM301` duplicate local ID; `YM302` unresolved concept reference; `YM303` duplicate document ID |
| `YM4xx` | Profile conformance | `YM401` unknown concept kind; `YM402` unknown relationship kind; `YM403` unavailable profile; `YM404` incompatible endpoint; `YM405` misplaced controlled field |
| `YM5xx` | Claim consistency | `YM501` competing whole-part claims |

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

Explicit files are checked as one workspace. Exit status is `0` when valid,
`1` for correctness diagnostics, and `2` for invocation or file errors.
`--json` emits a deterministic `{ "ok", "diagnostics" }` object. The command
does not write compiled artifacts.

## Deliberate exclusions

This foundation does not define ownership, status, evidence, arbitrary
properties, cross-document references, external profile discovery,
derived claims, projections, adapters, repository file discovery, or
governance workflow. These require separate semantic decisions or later
conformance work.
