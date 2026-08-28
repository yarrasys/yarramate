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

A concept may declare the folder it files itself under:

```yaml
concepts:
  - id: payments-api
    kind: applicationService
    name: Payments API
    folder: Payments/Core
```

`folder` is a LABEL, never a directory: the filesystem is not consulted, and
nothing resolves it (ADR 0104). It compiles to a stable `~folder` claim with
predicate `yarramate/organisation/folder` carrying a **value**, not a
reference — a folder is an organising word, not a subject that can be related,
owned or reported on, and two documents writing the same label mean the same
folder without either naming the other. Nest with `/`.

An editor groups the model by whatever a subject declares here, and by the
subject's ArchiMate layer where it declares nothing. Core reads the claim and
checks its shape; it derives no meaning from a folder and no diagnostic
depends on one.

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

A concept may record which subjects it took over from:

```yaml
concepts:
  - id: order-api
    kind: applicationComponent
    name: Order API
    supersedes:
      - order-gateway
```

Each entry compiles to a `yarramate/lineage/supersedes` reference claim
whose ID derives from the predecessor's identity, so reordering the list
leaves the canonical graph byte-identical. One predicate carries every
shape, because the shape is cardinality (ADR 0080): one entry is a rename,
several entries on one successor are a merge, and one predecessor named by
several successors is a split. Recording it on the successor means a new
subject arrives complete, in one document, saying where its responsibility
came from.

A predecessor is **not** required to be retired. The transition period
during which the old thing and the new thing both run is real, and both may
equally be `planned` while a split is still being designed. Retirement
stays the separate descoping decision it is under ADR 0064; succession says
only where the responsibility went.

`YM312` reports an unresolved succession reference, `YM313` a subject
declaring that it supersedes itself, and `YM504` a succession cycle, which
asserts that a subject is its own ancestor.

Briefs read these claims in both directions, so a successor reads
"Succeeds ..." and a predecessor reads "Superseded by ...". That is the
answer to "where did this go?" a month after the refactoring.

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
or relationships, named by the authored ID. Core rejects
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
within the compiled workspace. A compiled subject ID is the authored ID
itself, unique across the workspace, so moving a file, moving a subject between
documents, or reordering a YAML list does not change semantic identity.

Relationship endpoints refer to concepts by that ID, and a reference resolves
the same way wherever it is written. File paths never participate in identity
or resolution. Relationship IDs are authored and stable.

Until 1.0 a subject ID was `<document-id>#<local-id>`, and an ID only had to be
unique within its own document. Two documents could each declare `contact-record`
and mean different things. Flattening makes one ID one subject, which is why
`check` refuses a workspace whose documents declare the same ID twice (YM314):
that refusal is what makes the shorter form safe.

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
architecture-state ordering, and `presentIn` references name a subject by its ID
and have the same correctness checks wherever it was declared. Architecture
states are workspace planning contexts and may be declared in one document and
referenced from any other compiled document.

There is no correctness threshold for concepts or relationships per document.
The practical cost of decomposition is reviewing more files. Moving an existing
subject between documents no longer changes its identity, so file layout is a
reviewing and ownership decision rather than a semantic one - which it was not
before 1.0, when a move was a rename that had to be chased through every
reference.

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

`compileWorkspaceIncremental(sources, previous)` compiles the same graph for a
consumer that recompiles the whole workspace on every write. It re-parses only
the sources whose text differs from the opaque cache the previous call
returned, and reports `incremental: false` when it fell back to a full
compile. Reuse is decided by source-text equality rather than a declared
change set, so a stale or wrong cache costs parse work and cannot change the
compiled result (ADR 0091).

## Diagnostics

Diagnostics have stable codes, severity, message, source path, YAML pointer,
and one-based line and column.

A published result also names the **subjects** a diagnostic is about, most
relevant first, wherever its pointer identifies one. A consumer that draws the
model needs the subject rather than the byte offset, and the rules already knew
it: YM404 interpolates both endpoint ids into its own message. The list is
derived once from the pointer, at the boundary that publishes the result, so
the compiler's own diagnostics stay a pure function of the model and no rule
has to remember to name what it refused.

Absence is meaningful, and is not the same as "not populated". Every diagnostic
pointing into `/concepts/<n>` or `/relationships/<n>` carries its subject, so
the ones that carry none are exactly the ones that belong to no subject: a YAML
parse failure, a whole-document schema violation, a projection's own
definition, a workspace manifest. A consumer may treat an empty list as "this
belongs somewhere other than the canvas" rather than as missing data, and
should surface those somewhere, or a reviewer sees a refusal with nothing
marked anywhere.

| Range | Category | Initial codes |
| --- | --- | --- |
| `YM1xx` | YAML parsing | `YM101` malformed YAML |
| `YM2xx` | Document structure | `YM201` JSON Schema violation |
| `YM3xx` | Identity and references | `YM301` duplicate local ID; `YM302` unresolved concept reference; `YM303` duplicate document ID; `YM304` unresolved owner or attestation authority; `YM305` unresolved constraint; `YM306` duplicate constraint ID; `YM307` unresolved architecture state; `YM308` unresolved subject reference; `YM309` duplicate reference ID; `YM310` unresolved distinct-from reference; `YM311` self-referential distinct-from; `YM312` unresolved succession reference; `YM313` self-referential succession; `YM314` cross-document duplicate ID; `YM315` unresolved or doubly-bound pattern part |
| `YM4xx` | Profile conformance | `YM401` unknown concept kind; `YM402` unknown relationship kind; `YM403` unavailable profile; `YM404` incompatible endpoint; `YM405` misplaced controlled field; `YM406` unavailable parent profile; `YM407`/`YM408` unavailable semantic parent; `YM409`/`YM410` inherited-name collision; `YM411` duplicate profile; `YM412` broadened constraint; `YM413` rigid kind specializing an anti-rigid one; `YM414` mixed relationship kinds on one junction; `YM415` relationship forbidden by a declared constraint; `YM416` unbound required part; `YM417` part of the wrong kind; `YM418` relationship contradicting a pattern's wiring; `YM419` parts on a kind with no pattern, or an undeclared slot; `YM420` derived wiring or expansion id already taken; `YM421` macro edge with an unbound landing slot |
| `YM5xx` | Claim consistency | `YM501` competing whole-part claims; `YM502` cyclic state ordering; `YM503` relationship present without an endpoint; `YM504` cyclic succession |
| `YM6xx` | Adapter mapping integrity | `YM601` unknown native subject; `YM602` subject type mismatch; `YM603` duplicate native mapping; `YM604` duplicate external mapping; `YM605` duplicate versioned mapping |
| `YM7xx` | Workspace resolution | `YM701` unsafe pattern; `YM702` unmatched pattern; `YM703` cross-category file |
| `YM8xx` | Evidence integrity | `YM801` unknown subject; `YM802` unknown claim; `YM803` duplicate target; `YM804` duplicate evidence document |

Compilation returns no partial graph when an error diagnostic exists.
Diagnostic arrays are ordered by path, line, column, code, and message.

## Relationship endpoints

The bundled profile validates every relationship against the ArchiMate 3.2
relationship table (ADR 0097). Both endpoints and the relationship kind
resolve to their core ancestors through profile lineage; the table then says
whether that kind may join that pair, and a pair it does not list is a
`YM404` error naming the kinds it does permit. Pairs the specification
derives are in the table and are accepted when written; the compiler never
derives a relationship that is not written. Every relationship on one
junction must be the same kind (`YM414`). An extension relationship kind may
narrow a permitted pair by aspect with `sourceAspects` or `targetAspects`
(`YM412`).

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

The model operations are `add-concept`, `add-relationship`,
`update-concept`, `update-relationship`, `delete-concept`,
`delete-relationship`, `rename-concept`, and `rename-relationship`.
Concept and relationship records accept the same
optional fields as the authoring format — for example `status`,
`description`, `aka`, `owner`, `distinctFrom`, `supersedes`,
`constraints`, `references`, `presentIn`, `attestations`, and the
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

Text a write emits is quoted so that it reads the same under every YAML
version. YarraMate reads YAML 1.2, where a plain `on` is the string `on`.
YAML 1.1, still PyYAML's default and most non-JS loaders', resolves that
same plain `on` to the boolean `true` and a plain `2026-08-27` to a date, so
an attestation written as `on: 2026-08-27` reaches someone's audit script as
`{True: date(2026, 8, 27)}` rather than the record its author wrote (#378).
Every string a write produces is therefore measured against both versions
and double-quoted wherever they disagree (`"on": "2026-08-27"`, `"no"`,
`"0o17"`), a form both versions read back as the string that was authored.
Authored bytes are untouched by this, as they are by every other write: the
rule applies to text YarraMate produces, and a hand-written plain `on:` is
still read as the string it is.

Two operations — `rename-concept` and `rename-relationship` — move a
subject's local id. A rename is an identity edit, not a succession: it
writes no `supersedes` entry and retires nothing, because one subject kept
its identity and changed its address (ADR 0094). It is total within the
workspace — the declaration and every declarative reference to it move in
the same atomic batch, across documents, projections, evidence overlays and
adapter mappings — so nothing is left addressing an id that stopped
existing. Only matched scalars' own bytes change, so a bare reference stays
bare, a qualified one stays qualified, an `~aspect` suffix is preserved, and
the original quoting is kept. Comparison is on the qualified address, so a
same-local id in another document is untouched, and prose is left exactly as
written. A rename is refused when the id is not declared, when `to` equals
the current id, when the document declares an architecture state with the
old or new local id, when a reference position holds a YAML alias, and — by
the compile gate, before a byte is written — when the new local id is
already taken. `apply` re-reads every file it touched and refuses `YM913` if
any of them still names an address it moved off. Use succession
(`supersedes`, ADR 0080) when two real subjects are involved: split, merge,
or responsibility moved.

Three further operations — `add-observation`, `update-observation`, and
`delete-observation` — address an evidence overlay declared by the
manifest's `evidence` list rather than a model document. An overlay entry
has no `id`, so an observation is addressed by the pair (target, key)
instead (ADR 0089); `docs/EVIDENCE.md` covers the shape. They pass the same
atomic gate: the candidate workspace compiles and every touched overlay is
evaluated against the compiled graph before anything is written.

An `attestations` entry an operation writes must carry `recordedBy`, even
though a hand-authored document may omit it: a batch is a machine's
transcription of someone's judgment, so the operations contract names the
hand that held the pen where git already names the committer (ADR 0082).

The workspace manifest supplies the extension profiles and documents needed
for qualified references. This explicit input contract matches
`compileWorkspace`; `apply` does not search parent directories, infer a
workspace, or fetch a profile registry.

## Deliberate exclusions

This foundation does not define arbitrary properties, automatic profile or
repository discovery, remote registries, inferred claims, adapter execution
or round-tripping, constraint-policy execution, or governance workflow. These
require separate semantic decisions or later adapter and conformance work.

`docs/MODEL-FLOOR.md` states the whole of it as a contract: which facts a
model holds and how, which it declines, and where a declined fact belongs
instead. Read it before concluding that something has no home, because the
homes are not all obvious. A value that carries architectural weight, for
instance, is modelled as a subject other subjects point at rather than as a
property repeated on each of them, and the shipped policy profile is the
worked example.
