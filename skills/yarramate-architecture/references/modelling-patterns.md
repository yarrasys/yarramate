# Modelling patterns

Named solutions to problems that recur when authoring native documents. Each
entry states the problem, the solution, what the pattern prevents, and a
worked example.

Cite a pattern by name in design prose and review comments. The names exist so
that a recurring solution is quoted rather than re-derived.

Every pattern here is already practiced in this repository, and each entry
names its source so a reader can check it rather than trust the summary.

## Invocation chain

**Problem.** "The user invokes the command" and "this component invokes that
one" are the two most natural sentences in an architecture conversation, and
both fail when written as `triggering`. Triggering requires behavior at both
ends. An actor and a component are active structure, so the compiler rejects
the relationship.

**Solution.** Name the behavior that is invoked, assign every performer to it,
and reserve `triggering` for edges between behaviors. The invocation becomes
two assignments, and the chain becomes a sequence of behavior-to-behavior
steps. This is the model the diagnostic itself recommends: its repair hint
reads `introduce a behavior concept and "assignment"`.

**Prevents.** `YM404` on `triggering`, whose source and target must both be
behavior.

**Worked example.** `native-authoring.md`, section "Invocation chains".

The named behavior is also what makes the step addressable later. A dynamic
view orders relationships between behaviors, so a chain modelled as actors
invoking components has nothing to order.

## Degraded edge

**Problem.** Aspect policy blocks the kind that carries the meaning you want.
The common case is `triggering` between two components, where the relationship
is real and the kind is illegal.

**Solution.** Keep the edge legal with `kind: flow` and carry the invocation
semantics on the edge's `name` and `description`. Both compile into claims, so
evidence can later confirm or contradict the recorded semantics. The
degradation loses no reviewable information: it moves the meaning from the
kind to two fields that are still checked and still rendered.

`serving` and `flow` declare no endpoint aspect constraints, so neither can
raise `YM404`. That is what makes them available as the legal carrier.

**Prevents.** `YM404`, and the worse alternative of dropping a real
relationship because no kind fits.

**Worked example.** `native-authoring.md`, section "Degrading a blocked kind".

Reach for the invocation chain first. Degrading records that the edge exists;
the chain records the behavior, which is the better model whenever the
behavior has a name worth having.

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

**Solution.** Give the component a host with `serving` or `assignment` from a
`node`, `device`, or `systemSoftware`. Give each build output an `artifact`,
assigned to the node that deploys it, with `realization` to the component or
data it materializes.

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
    kind: assignment
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
