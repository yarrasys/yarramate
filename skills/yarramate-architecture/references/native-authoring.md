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

Paths are relative to the manifest. Keep canonical inputs under `.yarramate/`
and generated artifacts under `.yarramate-out/`.

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

## Stable commands

```sh
yarramate init .
yarramate add .yarramate/architecture/main.yaml \
  --id delivery-api --kind applicationComponent --name "Delivery API"
yarramate connect .yarramate/architecture/main.yaml \
  --id api-realizes-service --kind realization \
  --from delivery-api --to delivery-service \
  --description "The API implements the agreed delivery boundary" \
  --reference decision-source=delivery-service
yarramate check .yarramate/workspace.yaml --json
yarramate compile .yarramate/workspace.yaml
yarramate context <projection.yaml> .yarramate/workspace.yaml
yarramate view <projection.yaml> .yarramate/workspace.yaml
yarramate compare <from-state> <to-state> .yarramate/workspace.yaml
yarramate evidence <evidence.yaml> .yarramate/workspace.yaml
yarramate reconcile .yarramate/workspace.yaml
```

Treat exit `0` as successful execution, `1` as correctness diagnostics, and
`2` as invocation or file failure.
