# Modelling patterns

Named solutions to problems that recur when authoring native documents. Each
entry states the problem, the solution, what the pattern prevents, and a
worked example.

Cite a pattern by name in design prose and review comments. The names exist so
that a recurring solution is quoted rather than re-derived.

Every pattern here is already practiced in this repository, and each entry
names its source so a reader can check it rather than trust the summary.

## Invocation chain

**Problem.** "This component invokes that one" is the most natural sentence
in an architecture conversation, and drawn as one edge between two
components it names no step for anything to bind to. Protocol, trust,
payload, and failure handling all attach to behaviour, so a model made of
component-to-component lines has nowhere to record them.

**Solution.** Name the behaviour that is invoked, assign its performer, and
chain steps as behaviour-to-behaviour `triggering` or `flow`. The edge between
components stays legal and may stay drawn; the behaviour is what the interview
and the dynamic views address.

**Prevents.** An interaction wave with nothing to interrogate
(`hop-unrealised`), and a dynamic view with nothing to order.

**Worked example.** `native-authoring.md`, section "Interactions between
components".

Retired: *degraded edge*. Until ADR 0097, `triggering` between two components
was rejected and authors carried the meaning on a `flow`. ArchiMate permits
that triggering, so an edge recorded as `flow` only to dodge the old rule
should be re-kinded to `triggering` or `serving`.

## Delivery with content

**Problem.** Two behaviors are ordered and something is handed from the first
to the second. Recording only the order loses what moved. Recording only the
handover loses the sequence.

**Solution.** Keep both edges. `triggering` records precedence, and `flow`
with `content` records what was transferred.

```yaml
relationships:
  - id: parse-triggers-structure-validation
    kind: triggering
    from: parse-document
    to: validate-document-structure
  - id: parser-flows-document
    kind: flow
    from: parse-document
    to: validate-document-structure
    content: Parsed document
```

**Prevents.** `YM405`, since `content` is valid only on `flow`, and the silent
loss of the payload when only precedence is modelled.

**Choosing between flow and serving.** These answer different questions rather
than competing for the same edge. Serving makes behavior or an interface
available, and answers "who consumes this". Flow transfers information, value,
goods, or material, and answers "what moved, and which way". A service with a
consumer wants serving. A handover whose content matters wants flow. A model
often carries both between the same pair.

**Source.** This repository's self-model pairs the two edges exactly this way
through the compile pipeline, in `.yarramate/architecture/engine.yaml`.

## One answer, many subjects

**Problem.** The interview reports one question open against many subjects.
Ownership is the classic case: twenty components, one question, "who owns
this". Answering it as twenty interview turns spends twenty round trips
landing a single policy decision.

**Solution.** Collect the answer once at policy level, "who owns what, by
area", then land it across every listed subject as one `apply` batch. Re-run
`design` afterwards, because the next question is recomputed from the model.

```yaml
format: yarramate/operations/v1
operations:
  - op: update-concept
    document: architecture/main.yaml
    concept: {id: checkout, owner: payments-team}
  - op: update-concept
    document: architecture/main.yaml
    concept: {id: refunds, owner: payments-team}
  - op: update-concept
    document: architecture/main.yaml
    concept: {id: catalogue, owner: merchandising-team}
```

**Prevents.** A partially answered model. Any invalid operation rejects the
whole batch, so the model never holds half a policy decision.

**Trigger.** A `design` step reporting several entries in `openSubjects` for
one question. That list is the signal to stop interviewing and start batching.

An owner is a reference, not a label: `payments-team` above must be a concept
declared in the model, or the batch fails with `YM304` for an unresolved owner
reference. Declare the accountable actors in the same batch when they do not
exist yet.

## Descoping by retirement

**Problem.** A subject leaves scope. Deleting it destroys the record that it
was ever considered, and leaves the catalogue asking about the hole it left.

**Solution.** Set `status: retired` and put the reason in `description`.
Retirement is a closed question: retired subjects leave the enrichment target
set entirely, so no subject-scoped question stays open against them. They
still participate as counterparts and still appear in reads. Delete only when
the history itself is noise, and expect deletion to be rejected while anything
still references the target.

```yaml
- id: offline-mode
  kind: requirement
  name: Offline mode
  status: retired
  description: >-
    Descoped after the connectivity survey. Revisit if field usage exceeds
    the assumption recorded on the driver.
```

**Prevents.** Permanently open questions against abandoned work, and the loss
of a decision a later reader would otherwise re-litigate.

### Declining at inception

The same motion records a non-goal. A goal, outcome, or requirement authored
`status: retired` from the start, with its rationale in the description, is
the declared non-goal record. `export markdown` and `export briefs` render
those under a Non-goals heading, so the decision reaches the stakeholder
asking "what are we not doing" without a second status value existing to
carry it.

## Hosting a component

**Problem.** A component is modelled with no runtime. The model then says what
the system does and nothing about where it does it.

**Solution.** Give the component a host with `realization` or `serving` from
a `node`, `device`, or `systemSoftware`. Give each build output an `artifact`,
assigned to the node that deploys it, with `realization` to the component or
data it materializes. Technology is never assigned to a component: assignment
runs from the node to what it carries, and "deployed on" is the realization
that chain derives.

```yaml
concepts:
  - id: delivery-api
    kind: applicationComponent
    name: Delivery API
  - id: delivery-cluster
    kind: node
    name: Delivery cluster
  - id: delivery-image
    kind: artifact
    name: Delivery container image
relationships:
  - id: cluster-hosts-api
    kind: realization
    from: delivery-cluster
    to: delivery-api
  - id: cluster-deploys-image
    kind: assignment
    from: delivery-cluster
    to: delivery-image
  - id: image-realizes-api
    kind: realization
    from: delivery-image
    to: delivery-api
```

**Prevents.** The technology-wave questions the interview will otherwise keep
asking: "Where does X run?", "What does X host or serve?", and "What deploys
X, and what does it materialize?"

**Why it is material.** The hosting boundary decides latency, failure domain,
scaling model, and data residency. A component with no declared runtime is
deployed by whoever gets there first.

## Recorded succession

**Problem.** A component is renamed, split in two, or merged with another,
and the model records one retirement and two arrivals with nothing joining
them. A month later the refactoring is invisible, and so is the answer to
"where did this go?" Nothing in two documents distinguishes a rename from a
coincidence of naming, so the connection is recorded or it is lost.

**Solution.** Name the predecessors on the subject that took the work over,
using `supersedes`. One predicate covers every case, because the shape is
cardinality (ADR 0080): one entry is a rename, several entries are a merge,
and one predecessor named by several successors is a split.

```yaml
concepts:
  - id: order-api
    kind: applicationComponent
    name: Order API
    supersedes:
      - order-gateway
  - id: order-events
    kind: applicationComponent
    name: Order Events
    supersedes:
      - order-gateway
  - id: order-gateway
    kind: applicationComponent
    name: Order Gateway
    status: retired
```

Two successors naming one predecessor is the split. Write it on the
successor, at the moment you introduce it, which is the moment you know:
the new subject then arrives complete in one document, and the predecessor's
document is not touched.

**Prevents.** `YM312` when a lineage points at nothing, and the silent loss
of the history that explains why the current model looks the way it does.

**Do not retire the predecessor just because it has a successor.** The
transition period during which both run is real, and both may be `planned`
while the split is still being designed. Retirement is the separate
descoping decision of ADR 0064. Equally, a retired subject with no
successor is a legitimate record: some things are decommissioned into
nothing, and the model should not invent a destination for them.

**Worked example.** `.yarramate/architecture/engine.yaml`, where the 0.7.0
clean break to seven verbs (ADR 0061) is recorded as a merge, a split, and
a rename against the retired command services.
