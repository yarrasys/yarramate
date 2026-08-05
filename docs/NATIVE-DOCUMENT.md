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

Optional concept and relationship `description` fields compile into explicit
narrative claims about their respective subjects. Relationship `name` remains
a concise label. A description may record rationale, conditions, consequences,
or other decided architecture, but Core treats its text as opaque rather than
as executable logic.

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

A concept may record the other names it is known by:

```yaml
concepts:
  - id: order-gateway
    kind: applicationComponent
    name: Order Gateway
    aka:
      - OG
      - the gateway
```

Each entry compiles to a `yarramate/concept/alias` value claim whose ID
derives from the alias text, so reordering the list leaves the canonical
graph byte-identical. Alternative labels are matchable, never renderable
(ADR 0076): free-text seeding in `ask` matches them at the same weight as
the name, and every renderer keeps printing the preferred `name` alone.

A concept may also record that it has been judged genuinely different from
another subject it resembles:

```yaml
concepts:
  - id: order-gateway
    kind: applicationComponent
    name: Order Gateway
    distinctFrom:
      - orders-service
```

This compiles to a `yarramate/identity/distinct-from` reference claim and
permanently closes the `subjects-near-duplicate` hygiene question for that
pair (ADR 0077). It is read symmetrically, so one entry settles the pair
from either side, and it survives re-running the interview because it is
part of the model rather than session state. `YM310` reports an unresolved
reference and `YM311` a subject declared distinct from itself.

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

A constraint entry may also declare the observation it expects, which turns a
rule stated in prose into a fact a provider can testify about:

```yaml
concepts:
  - id: customer-data
    kind: dataObject
    name: Customer data
    constraints:
      - id: residency
        ref: australia-only
        expects:
          provider: terraform-scan
          key: region
          value: ap-southeast-2
```

`expects` names the provider expected to report the fact, the key that
provider reads, and the exact value the model expects to find there. It
compiles to `<subject>~expects-<id>` with predicate
`yarramate/constraint/expects`. Core checks nothing about the expectation
beyond its shape: it does not contact the provider, resolve the key, or decide
whether the value is architecturally correct. `yarramate reconcile` compares
the declared value with what the named provider observed, and
`yarramate check --strict` gates on a disagreement exactly as it gates on any
other contradicted evidence (ADR 0075).

The comparison is string equality. A provider that needs case folding, unit
conversion, or pattern matching normalizes before it reports, so the model
never carries a matching language of its own.

`constraints` and `realization` express different claims. A constraint entry
means the concept is bound by the referenced rule; a realization relationship
means its source implements or fulfils its target. A component that must obey a
rule uses `constraints`. A component that implements the mechanism described
by a rule may use `realization`. Declare both only when both facts are
architecturally meaningful; neither implies the other.

Concepts and relationships may cite any other workspace subject through
explicitly identified references:

```yaml
concepts:
  - id: lifecycle
    kind: businessProcess
    name: Item lifecycle
  - id: worker
    kind: applicationProcess
    name: Worker
    references:
      - id: governing-flow
        ref: worker-triggers-lifecycle
relationships:
  - id: worker-triggers-lifecycle
    kind: triggering
    from: worker
    to: lifecycle
    description: The worker advances the lifecycle only after retaining evidence.
    references:
      - id: normative-process
        ref: lifecycle
```

Each entry compiles to `<subject>~reference-<id>` with predicate
`yarramate/reference/refers-to`. Targets may be concepts, architecture states,
or relationships and may use local or `document#subject` identity. Core rejects
dangling targets and duplicate reference IDs within one subject. It does not
infer ownership, dependency, constraint, ordering, or other meaning from a
reference. ID-like text inside a description is not a reference and is not
checked.

Concepts and relationships may also declare an operational `status` of
`planned`, `current`, or `retired`. It compiles into a
`yarramate/lifecycle/status` claim. Status describes architecture lifecycle,
not review or approval; Git remains authoritative for governance.

Retirement also records scope that was considered and declined. A goal,
outcome, or requirement may be authored with `status: retired` from the
start, with the rationale in its `description`: that entry is the model's
non-goal record, and no dedicated status value exists for it (ADR 0073).
`export markdown` and `export briefs` render such subjects under a
Non-goals heading so declined scope stays visible to stakeholders. A
projection that lists `retired` in `excludeStatuses` keeps them out of
its exports entirely; exclusion always wins over rendering.

Documents may optionally declare baseline, transition, and target architecture
states. Concepts and relationships use concise `presentIn` references to
compile explicit presence claims:

```yaml
states:
  - id: baseline
    kind: baseline
    name: Current architecture
  - id: target
    kind: target
    name: Target architecture
    after: baseline
concepts:
  - id: new-service
    kind: applicationComponent
    name: New service
    presentIn: [target]
```

State IDs share the document-local identity namespace with concepts and
relationships. State and presence references resolve locally or through
`document#state`. Ordering must be acyclic, and an explicitly scoped
relationship cannot be present where either endpoint is absent. Unscoped
concepts apply to every state; unscoped relationships follow their endpoints.
Lifecycle status remains independent of planning state. The complete contract
is in `docs/ARCHITECTURE-STATES.md`.

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
across states, concepts, and relationships in one document, and a document ID is unique
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

## Decomposing a model

A native document is a stable semantic identity and review boundary, not a
required layer, diagram, subsystem, or file-size unit. Split documents when a
cohesive body of architecture is easier to own and review independently—for
example by subsystem, bounded responsibility, or kind of knowledge such as
structure, governance rules, interaction flows, and evolution planning. Keep a
small model together when splitting would add navigation without clarifying
ownership or review.

Cross-document endpoints, owners, constraints, identified references,
architecture-state ordering, and `presentIn` references use globally qualified
`document#subject` identities and have the same correctness checks as local
references. Architecture states are workspace planning contexts and may be
declared in one document and referenced from any other compiled document.

There is no correctness threshold for concepts or relationships per document.
The practical costs of decomposition are explicit qualification and reviewing
more files. Moving an existing subject between documents changes its globally
qualified identity, so choose durable boundaries and treat later moves as
semantic renames rather than harmless file organization.

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

Concept authoring emits kind, name, optional description, and optional
identified-reference claims. Relationship authoring emits one semantic
relationship claim plus optional name, description, and identified-reference
claims about the relationship subject. Every claim records its YAML pointer and
one-based source location.

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
| `YM3xx` | Identity and references | `YM301` duplicate local ID; `YM302` unresolved concept reference; `YM303` duplicate document ID; `YM304` unresolved owner; `YM305` unresolved constraint; `YM306` duplicate constraint ID; `YM307` unresolved architecture state; `YM308` unresolved subject reference; `YM309` duplicate reference ID; `YM310` unresolved distinct-from reference; `YM311` self-referential distinct-from |
| `YM4xx` | Profile conformance | `YM401` unknown concept kind; `YM402` unknown relationship kind; `YM403` unavailable profile; `YM404` incompatible endpoint; `YM405` misplaced controlled field; `YM406` unavailable parent profile; `YM407`/`YM408` unavailable semantic parent; `YM409`/`YM410` inherited-name collision; `YM411` duplicate profile; `YM412` broadened constraint; `YM413` rigid kind specializing an anti-rigid one |
| `YM5xx` | Claim consistency | `YM501` competing whole-part claims; `YM502` cyclic state ordering; `YM503` relationship present without an endpoint |
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
with overlapping relationship applicability is contradictory: one whole-part
assertion cannot be both strong and weak in the same architecture state. The
check is workspace-wide, so separating the assertions into different native
documents does not avoid it. An unscoped relationship overlaps every state in
which both endpoints participate. Explicitly disjoint state scopes may use
different whole-part kinds to describe an architectural transition. This is
the first deliberately narrow contradiction rule.

## Check CLI

```sh
yarramate check architecture.yaml
yarramate check architecture/*.yaml --json
```

Explicit files are checked as one workspace, so qualified references may cross
between them. Exit status is `0` when valid,
`1` for correctness diagnostics, and `2` for invocation or file errors.
`--json` emits a deterministic `yarramate/check-result/v1` object with `ok`,
`diagnostics`, and successful-workspace `counted` totals for documents,
concepts, relationships, and architecture states. Its normative structure is
`schema/yarramate-check-result.schema.json`, exported as
`yarramate/schema/check-result`. The command does not write compiled artifacts.

## Safe authoring CLI

```sh
yarramate init .
```

`init` creates `.yarramate/architecture/main.yaml` and `.yarramate/workspace.yaml`, and
refuses to overwrite either. Writes then land as one atomic validated batch:
a `yarramate/operations/v1` document lists operations addressed to
manifest-declared documents, and `yarramate apply` executes it against the
explicit workspace manifest:

```yaml
format: yarramate/operations/v1
operations:
  - op: add-concept
    document: .yarramate/architecture/main.yaml
    concept:
      id: order-approval
      kind: capability
      name: Order approval
  - op: add-relationship
    document: .yarramate/architecture/main.yaml
    relationship:
      id: api-realizes-approval
      kind: realization
      from: approval-api
      to: order-approval
```

```sh
yarramate apply operations.yaml .yarramate/workspace.yaml
```

The operations are `add-concept`, `add-relationship`, `update-concept`,
`update-relationship`, `delete-concept`, and `delete-relationship`. Concept
and relationship records accept the same
optional fields as the authoring format — for example `status`,
`description`, `aka`, `owner`, `distinctFrom`, `constraints`,
`references`, `presentIn`, and the
controlled `mode` and `content` fields. `apply` writes by splicing minimal
text edits into the authored source, so bytes an operation never touched —
including folded prose and comments — stay byte-identical (ADR 0062). It
compiles the entire candidate workspace in memory and replaces the targets
only when validation succeeds; a rejected batch leaves every source
byte-for-byte unchanged. Update operations enrich by default — scalar
fields replace, list fields append — and retract explicitly: an update may
carry `remove: [<field> ...]` to delete optional fields it previously
asserted. Identity fields (`id`, `kind`, `from`, `to`) are never removable,
removing a field that is not set is an error, and one operation cannot both
set and remove the same field. Delete operations remove the whole authored
item and are rejected while anything still references the target —
relationship endpoints, `owner`, constraint refs, identified references.
Integrity is evaluated against the post-batch state, so a concept and its
referring relationships can leave in one batch (ADR 0069). Retirement
(`status: retired`) remains the descoping path; delete only when the
history itself is noise.

The workspace manifest supplies the extension profiles and documents needed
for qualified references. This explicit input contract matches
`compileWorkspace`; `apply` does not search parent directories, infer a
workspace, or fetch a profile registry.

## Deliberate exclusions

This foundation does not define arbitrary properties, automatic profile or
repository discovery, remote registries, inferred claims, adapter execution
or round-tripping, constraint-policy execution, or governance workflow. These
require separate semantic decisions or later adapter and conformance work.
