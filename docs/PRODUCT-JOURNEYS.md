# Product journeys

YarraMate provides one repository-native architecture system for two primary
agent-assisted journeys. Native documents are canonical in both; the
difference is how an architecture proposal begins.

## Discover an existing project

An agent harness starts with implementation and repository evidence:

1. orient to the repository, its boundaries, and its existing YarraMate
   workspace, if any;
2. inspect source and provider observations without treating them as declared
   intent;
3. propose concise native concepts, relationships, states, ownership, and
   constraints;
4. run deterministic checks and correct structural failures;
5. produce focused context and visual projections;
6. reconcile proposed or existing declared claims with available evidence;
7. leave a reviewable Git change for a person to accept, revise, or reject.

The initial workflow may use agent inspection directly. Graphify can later
supply repeatable observed evidence through an optional adapter. Neither path
automatically promotes observations into canonical claims.

### Smallest useful outcome

- a valid `.yarramate/workspace.yaml`;
- one or more concise native architecture documents;
- explicit provenance in the Git change and optional evidence overlays;
- at least one useful projection;
- when visual output is selected, the intended views rendered - natively in a
  visual conversation, or as a current generated LikeC4 project, or both;
- explicit reporting of modelled subjects or flows that the views omit;
- deterministic `check` and context output;
- a deterministic reconciliation report when evidence overlays exist;
- no unreviewed mutation of architectural intent.

## Design a new solution

An agent harness starts with intent rather than implementation:

1. capture drivers, stakeholders, goals, constraints, and required outcomes;
2. identify solution boundaries, capabilities, information, responsibilities,
   and dependencies;
3. explore materially different alternatives without prematurely modelling
   every detail;
4. declare the selected current or target architecture in native documents;
5. check deterministic correctness and render stakeholder-focused views;
6. provide bounded semantic context to implementation agents;
7. reconcile the declared architecture with evidence as the project is built.

The guided methodology should make routine authoring concise and tolerate
partial models. Core validation does not convert missing detail or an
unfashionable design into an error.

### Smallest useful outcome

- agreed drivers and constraints represented as architectural concepts;
- a coherent target solution boundary and its principal relationships;
- alternatives or state transitions recorded only where they aid a decision;
- focused projections suitable for review and agent context;
- when visual output is selected, the intended views rendered by either
  visualization adapter and an explicit rendering-coverage statement;
- valid native documents ready to evolve alongside implementation.

## Maintain an existing model

An agent harness starts from a model that already validates:

1. discover the repository's authored workspace, evidence, projection, and
   adapter paths;
2. establish a passing read-only baseline;
3. find every reference to the subjects or claims being changed;
4. update the smallest coherent set of canonical inputs;
5. verify Core and optional adapters before applying any repair command;
6. review mapping repairs as ordinary tracked authoring changes;
7. require the maintained model and configured adapters to pass before
   handoff.

This journey covers normal evolution such as renames, retired concepts,
changed relationships, and gaps resolved into decisions. It does not introduce
an approval workflow. A mutating synchronization command cannot serve as a CI
verification gate.

## Shared lifecycle

```text
repository evidence ─┐
                     ├─> architecture proposal ─> Git review ─> declared intent
design conversation ─┘                                      │
                                                            v
                                              bounded implementation context
                                                            │
                                                            v
                                               evidence and reconciliation
```

An architecture proposal is a candidate native-document change, not a new
claim origin and not an approval state. Once accepted in Git, its content is
declared architecture. Observations remain evidence; generated diagrams remain
projections.

## Harness boundary

Codex, Claude Code, and other agent harnesses may inspect repositories, invoke
the CLI, edit native documents, and present changes under their existing
permissions. YarraMate supplies deterministic operations and guided
methodology, not an autonomous governance actor.

The portable integration surface is:

- the stable CLI;
- versioned native and workspace schemas;
- machine-readable diagnostics, graph, projection, comparison, and evidence
  results;
- repository-local profiles and projections.

Skills compose these surfaces rather than depending on an undocumented
library helper or a harness-specific architecture format.

The first portable workflow is implemented in
`skills/yarramate-architecture/`. Executable discovery and design examples
live under `test/fixtures/journeys/` and are verified through the stable CLI in
`test/journeys.test.ts`.
