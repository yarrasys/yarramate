# Interrogation

`yarramate ask --open` evaluates a versioned question catalogue against the
compiled workspace and reports which design questions are still open. It is
the gap engine behind the enrichment interview: deterministic detection of
what the model has not yet answered, with the answering left to people and
agents.

```sh
yarramate ask .yarramate/workspace.yaml --open
yarramate ask .yarramate/workspace.yaml --open --json
yarramate ask .yarramate/workspace.yaml --open --catalogue catalogues/custom.yaml
```

The command requires an explicit workspace manifest and evaluates the shipped
catalogue by default; `--catalogue` substitutes a custom one. `--json` emits
the deterministic `yarramate/interrogation-report/v1` report
(`schema/yarramate-interrogation-report.schema.json`) nested under a `report`
key inside the `yarramate/ask-result/v1` envelope. Exit status is `0` for
a valid report regardless of how many questions are open — an open question
is work, not an error; status `1` means the catalogue or workspace failed
deterministic correctness, and `2` means the invocation failed.

## Catalogues

A catalogue is a versioned YAML document
(`yarramate/question-catalogue/v1`, normative schema
`schema/yarramate-question-catalogue.schema.json`) declaring waves and
questions. Each question binds:

- a **trigger** — one or more deterministic conditions over the compiled
  graph (all must hold): `missing-claim`, `missing-relationship`,
  `isolated`, `no-subject-of-kind`, `no-state-defined`,
  `missing-linkage` (no relationship of given kinds, in a given
  direction, whose counterpart is of a given kind — the linkage-depth
  primitive), `has-linkage` (the positive of `missing-linkage`;
  `direction` may be `either`), `exists-linkage` (workspace: some
  concept would satisfy `has-linkage`), `missing-constraint` (no
  `yarramate/constraint/requires` binding whose target matches the
  given kinds), `missing-flow-content` (the subject is an endpoint of a
  `flow` that has no `content`), `missing-reference` (no reference-bearing claim such as a
  constraint binding, by direction), `missing-attestation` (no
  recorded `yarramate/attestation/<topic>` claim; see ADR 0056),
  `near-duplicate` (the subject resembles another subject of the same
  kind closely enough to be the same thing under two names, and no
  `yarramate/identity/distinct-from` claim dismisses the pair; the
  algorithm and its thresholds are stated in ADR 0077), or
  `unconstrained-kind` (every relationship the subject participates in
  would still be permitted by the ArchiMate relationship table if the
  subject were reclassified to a kind of another aspect, so its kind is a
  label no check can contradict; see ADR 0083 as amended by ADR 0097).
  Relationship kinds in conditions resolve through profile lineage by
  default, the same rule as subject selectors. The trigger rides reports
  and design steps verbatim as the question's machine-readable answer
  shape, so a consumer builds its answering affordance from the report
  instead of re-deriving the shape from a catalogue copy (ADR 0110);
- a **scope** — `workspace` (asked once) or `subject` (asked per matching
  subject, selected by kinds, statuses, and documents, with `descendants`
  kind matching by default so profile-derived kinds satisfy a catalogue
  written against their parents);
- a **materiality** statement — the decision its answer changes. A question
  that cannot state one is deleted, not softened;
- an **authority** — `human`, `agent`, or `either` — declaring who may
  answer. It is a label carried into reports, not a gate: nothing stops
  an agent writing the attestation that closes a `human` question, so the
  record names the authority in `by` and the writer in `recordedBy`, and
  `reconcile` reports the two disagreeing (ADR 0082);
- a **resolution** hint — how an answer is typically modelled;
- a **question** phrasing interpolating `{subject.id}` and
  `{subject.name}`, plus `{counterparts}` for questions whose trigger
  names other subjects, such as `near-duplicate`;
- an optional **askPlain** phrasing: the same question in plain
  workshop language, interpolating the same `{subject.id}` and
  `{subject.name}` placeholders. `design --facilitate` prefers it and
  falls back to the standard phrasing when a question has none
  (ADR 0072).

The engine ships an internal core-enrichment catalogue, seed questions
across motivation, interaction, business, application, technology,
implementation, and hygiene waves for `yarramate/core@0.1`, evaluated
when no `--catalogue` is given. Interaction questions that name
`yarramate/policy@0.1` kinds are omitted unless a document selects that
profile (ADR 0095).
Catalogues are ordinary versioned data: extend the shipped one under a new
identity or write one per organisation, then pass it with `--catalogue`.
Composition via `extends` is deferred from v1 (ADR 0053).

## Evaluation model

A question is **open** iff its trigger matches, and **closed** the moment it
no longer does. A question is **not applicable** when any kind it names
belongs to a profile that no document in the workspace has selected
(`graph.profiles`). Inapplicable questions are omitted from the report and
from `summary.questions`; they are not `open: false`. Interview state is
recomputed from model plus catalogue on every run and never stored: no
session files, no second canonical store, nothing to resume. Editing the
model and re-running yields exactly the still-open questions.

Open questions are not findings against anyone. `check` answers "is this
model well-formed", `reconcile` answers "does reality agree", and
`ask --open` answers "what has nobody decided yet". Only the first two can
fail a gate; the third produces the agenda for the next design conversation.

## The interview loop

The intended use is agent-mediated: an agent structures what a prompt or
conversation states, runs `ask --open`, and works the open questions wave
by wave — answering what evidence can answer and escalating questions marked
`human` with their materiality attached, so the person always knows what
decision their answer changes. Answers are captured back into the model
through the normal authoring surface and Git review; closure is then
automatic on the next run.

## Catalogue versioning

The shipped catalogue is versioned with the product and deepens over time
(ADR 0063). The discipline:

- **Minor versions are additive**: new questions and loosened triggers
  only. A model whose interview was complete honestly reopens when the
  path deepens — the model did not regress; the standard of adequacy grew.
- **Every question records `since`**, the catalogue version it first
  appeared in. Reports, design steps, and `ask --open` carry the marker
  (`[since 0.4]`), so consumers can attribute a reopened interview to the
  catalogue delta without diffing catalogue files.
- **There is no pinning.** The interview is stateless (ADR 0053/0058);
  storing "the version this model was interviewed against" would let
  models silently age against the path. Teams that need a frozen path can
  copy the shipped catalogue and pass `--catalogue` explicitly.
- **Major versions may change or remove triggers** — the only change
  class that can silently alter what an existing "complete" means, which
  is why it demands the major signal.
