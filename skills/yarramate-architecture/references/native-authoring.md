# Native authoring reference

Use concise YAML as the canonical source. Let the CLI compile it into explicit
claims.

## Workspace

```yaml
format: yarramate/workspace/v1
id: delivery
documents: [architecture/*.yaml]
profiles: []
projections: [projections/*.yaml]
adapterMappings: []
evidence: [evidence/*.yaml]
```

Paths are relative to the manifest. `.yarramate/` for canonical inputs and
`.yarramate-out/` for generated artifacts are recommended examples, not fixed
CLI paths. In an existing repository, read its workspace and project documents
and preserve the authored layout.

## Native document

```yaml
format: yarramate/v1
id: delivery
profile: yarramate/core@0.1
concepts:
  - id: customer
    kind: businessActor
    name: Customer
  - id: delivery-api
    kind: applicationComponent
    name: Delivery API
    status: planned
  - id: delivery-data
    kind: dataObject
    name: Delivery data
    constraints:
      - id: residency
        ref: australia-only
relationships:
  - id: api-accesses-data
    kind: access
    from: delivery-api
    to: delivery-data
    description: The API uses the governed record without maintaining a copy.
    mode: read-write
    references:
      - id: residency-policy
        ref: delivery-data
```

IDs are document-local and compile to `document-id#subject-id`. Cross-document
references must be globally qualified. Use `planned`, `current`, or `retired`
only for operational lifecycle—not approval or alternative selection.

Supported relationship kinds are:

```text
composition aggregation assignment realization serving access influence
association triggering flow specialization
```

Use `mode: read|write|read-write|unspecified` only with `access`. Use
`content` only with `flow`. Prefer a precise relationship over `association`;
use association when no stronger semantic meaning is justified.

Every concept kind carries an aspect: `motivation`, `active-structure`
(actors, roles, components, nodes, interfaces), `behavior` (processes,
functions, interactions, services, events), `passive-structure` (objects,
data, artifacts, material), or `composite`. Four relationship kinds constrain
endpoint aspects, and the compiler rejects violations as `YM404`:

```text
assignment  source must be active-structure
access      target must be passive-structure
influence   target must be motivation
triggering  source and target must be behavior
```

The other kinds accept endpoints of any aspect.

## Invocation chains

"User invokes command" and "component invokes component" fail `YM404` when
written as `triggering` between active-structure elements. Name the invoked
behavior, assign the performers, and trigger between behaviors:

```yaml
concepts:
  - id: user
    kind: businessActor
    name: User
  - id: cli
    kind: applicationComponent
    name: CLI
  - id: run-check
    kind: applicationProcess
    name: Run check
relationships:
  - id: user-starts-run-check
    kind: assignment
    from: user
    to: run-check
    name: User invokes the check command
  - id: cli-performs-run-check
    kind: assignment
    from: cli
    to: run-check
```

Chain steps with `triggering` only between behavior concepts, for example
`run-check` triggering a downstream process owned by another component.

## Degrading a blocked kind

When aspect policy blocks the kind you want—`triggering` between two
components is the common case—keep the edge legal with `kind: flow` and carry
the invocation semantics on the edge's `name` and `description`:

```yaml
format: yarramate/operations/v1
operations:
  - op: add-relationship
    document: .yarramate/architecture/main.yaml
    relationship:
      id: cli-invokes-engine
      kind: flow
      from: cli
      to: engine
      name: invokes
      description: The CLI invokes the engine once per check run
```

```sh
yarramate apply operations.yaml .yarramate/workspace.yaml
```

Both fields compile to claims, so evidence can later confirm or contradict
the recorded invocation semantics; the degradation loses no reviewable
information.

## Batched writes

Prefer `yarramate apply` when an answer or enrichment touches several
subjects: one atomic validated batch instead of repeated single calls.

```yaml
format: yarramate/operations/v1
operations:
  - op: add-concept
    document: architecture/main.yaml
    concept: {id: audit-log, kind: applicationService, name: Audit log, status: planned}
  - op: add-relationship
    document: architecture/main.yaml
    relationship: {id: api-serves-audit, kind: serving, from: audit-log, to: user}
  - op: update-concept
    document: architecture/main.yaml
    concept:
      id: user
      description: The person whose actions are audited.
```

```sh
yarramate apply operations.yaml workspace.yaml
```

The whole candidate workspace must compile or nothing is written.
Update operations enrich by default — scalars replace, lists append — and
retract explicitly with `remove: [<field> ...]`. Whole subjects leave
through `delete-concept` / `delete-relationship` (payload: the `id` only),
rejected while anything still references the target; delete the referring
relationships in the same batch. To descope, retire (`status: retired`)
instead — delete only when the history itself is noise.

## Ownership and constraints

```yaml
- id: checkout
  kind: capability
  name: Checkout
  owner: platform-team
  constraints:
    - id: residency
      ref: australia-only
```

Ownership is one accountable reference, not approval workflow. Constraints are
identified references, not a policy engine or free-form metadata bag.

## Attestations

```yaml
- id: shared-context
  kind: goal
  name: Shared architecture context
  attestations:
    - topic: adequacy
      by: reviewer-name
      on: "2026-08-01"
```

An attestation records that an authority accepted the subject as adequate
for a topic (the interrogation catalogue asks for `adequacy` on motivation
subjects and `design-review` on planned elements). The judgment stays
outside the engine — only the claim's existence is checked. Revoke by
deleting the entry; both signing and revoking are reviewed at the Git
boundary (ADR 0056).

## Rationale and citations

Use `description` on either a concept or relationship for decided narrative
about that exact subject. Use an identified `references` entry when the
narrative depends on another concept or relationship and the citation must
remain checkable:

```yaml
description: Failure releases the lease and retains partial evidence.
references:
  - id: failure-destination
    ref: retry-pool
```

Core checks the explicit target and local reference ID. It does not scan prose
for IDs or interpret descriptions as formal preconditions, postconditions, or
workflow rules.

For interaction flows, model steps that need identity as behavior concepts and
model normal or failure transitions as native relationships. A LikeC4 dynamic
view may order those projected relationships and display their descriptions;
the view does not become the workflow source of truth.

## Architecture states

```yaml
states:
  - id: baseline
    kind: baseline
    name: Before implementation
  - id: target
    kind: target
    name: Initial target
    after: baseline
concepts:
  - id: delivery-api
    kind: applicationComponent
    name: Delivery API
    presentIn: [target]
```

Use `baseline`, `transition`, and `target` as planning contexts. An unscoped
concept participates in every declared state. Scope relationships explicitly
when they should exist only in selected states.

## Projection

```yaml
format: yarramate/projection/v1
id: delivery-target
version: "1.0"
query:
  subjects:
    - delivery#delivery-api
    - delivery#delivery-data
  states:
    - delivery#target
  relationships: between
presentation:
  title: Delivery target
```

Selectors are portable and may match nothing. `relationships` accepts
`between`, `connected`, or `none`. Connected expansion is exactly one hop.
Kind selectors are globally qualified; `kindMatching: descendants` explicitly
includes profile descendants. `isolatedConcepts: exclude` may suppress
unconnected concepts without becoming a completeness rule.

## Evidence

```yaml
format: yarramate/evidence/v1
id: delivery-repository
version: "1.0"
provider: repository-inspection
observations:
  - subject: delivery#delivery-api
    result: confirmed
    evidence:
      uri: repo:src/delivery-api.ts
  - claim: delivery#api-accesses-data
    result: unknown
    evidence:
      uri: repo:src/delivery-api.ts
      message: Storage behavior is not clear
```

Evidence evaluates an existing subject or stable claim ID. Results are
`confirmed`, `contradicted`, `unknown`, or `not-observed`. Never add an
observed subject directly through evidence or mutate declared intent from an
evidence result.

## LikeC4 project

Keep visualization configuration outside native documents. Project `mapping`,
`kindMapping`, and `views[].projection` paths resolve from the
project-definition document's directory, so place the definition at or above
everything it references — `.yarramate/likec4-project.yaml` in this layout:

```yaml
format: yarramate/likec4-project/v1
id: delivery
version: "1.0"
title: Delivery architecture
mapping: integrations/likec4/subject-mapping.yaml
views:
  - projection: projections/delivery-target.yaml
  - id: submit-order
    projection: projections/submit-order.yaml
    dynamic:
      steps:
        - relationship: delivery#customer-triggers-submit
        - relationship: delivery#submit-triggers-confirmation
```

Give every ordered flow its own focused projection and dynamic view. A dynamic
view takes its title and description from its projection; reusing one broad
projection for several flows makes their rendered identities ambiguous.
Ensure every intended projection is listed in the project.
In an existing repository, locate the project by its
`yarramate/likec4-project/v1` format and follow its `mapping` field instead of
assuming the example paths below.

Start the referenced mapping as a valid empty mapping, then let sync populate
it:

```yaml
format: yarramate/adapter-mapping/v1
id: delivery-likec4
version: "1.0"
adapter: likec4
mappings: []
```

`export-project` writes `.yarramate-out/likec4/yarramate.generated.json` with
digests for generated files. It refuses to replace a generated file that was
hand-edited. Treat that refusal as drift to inspect; do not delete the marker
or overwrite the output manually.

## Stable commands

```sh
yarramate init .
yarramate design .yarramate/workspace.yaml
yarramate apply operations.yaml .yarramate/workspace.yaml
yarramate ask .yarramate/workspace.yaml
yarramate ask .yarramate/workspace.yaml <projection.yaml>
yarramate ask .yarramate/workspace.yaml <document-id>#<local-id>
yarramate ask .yarramate/workspace.yaml --next
yarramate ask .yarramate/workspace.yaml --open
yarramate ask .yarramate/workspace.yaml --compare <from-state> <to-state>
yarramate check .yarramate/workspace.yaml --json
yarramate reconcile .yarramate/workspace.yaml
yarramate export graph .yarramate/workspace.yaml
yarramate export markdown <projection.yaml> .yarramate/workspace.yaml
yarramate-likec4 check \
  .yarramate/likec4-project.yaml \
  --json \
  .yarramate/workspace.yaml
yarramate-likec4 map --sync \
  .yarramate/integrations/likec4/subject-mapping.yaml \
  .yarramate/workspace.yaml
yarramate-likec4 export-project \
  .yarramate/likec4-project.yaml \
  .yarramate-out/likec4 \
  .yarramate/workspace.yaml
```

`yarramate-likec4 check` is read-only verification and belongs in CI.
Run it before sync when checking an existing mapping so missing or stale
entries remain observable. `map --sync [--prune]` is an authoring repair: it
mutates a tracked mapping, so review and commit its diff. Never use a repair
command as a CI gate.

Sync preserves and reports mappings for native subjects that no longer exist.
After confirming that those subjects were intentionally removed or renamed,
delete the stale entries while adding missing mappings with:

```sh
yarramate-likec4 map --sync --prune \
  .yarramate/integrations/likec4/subject-mapping.yaml \
  .yarramate/workspace.yaml
```

Treat exit `0` as successful execution, `1` as correctness diagnostics, and
`2` as invocation or file failure.
