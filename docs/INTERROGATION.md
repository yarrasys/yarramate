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
  algorithm and its thresholds are stated in ADR 0077),
  `unconstrained-kind` (every relationship the subject participates in
  would still be permitted by the ArchiMate relationship table if the
  subject were reclassified to a kind of another aspect, so its kind is a
  label no check can contradict; see ADR 0083 as amended by ADR 0097), or
  `unchallenged-evidence` (the one condition that reads the workspace's
  evidence overlay rather than the compiled graph: it holds where the
  overlay records observations and every one is a frictionless
  confirmation — no contradicted, unknown, or not-observed result and no
  recorded search (ADR 0107) — so a discovery that never tested a claim
  it might fail is asked whether it did. An evaluation given no overlay
  treats the overlay's diversity as unknown, not absent, and stays
  quiet; the CLI paths supply the workspace's declared evidence, so only
  a consumer of the pure engine that passes none is in that position.
  See ADR 0120).
  Relationship kinds in conditions resolve through profile lineage by
  default, the same rule as subject selectors. The trigger rides reports
  and design steps verbatim as the question's machine-readable answer
  shape, so a consumer builds its answering affordance from the report
  instead of re-deriving the shape from a catalogue copy (ADR 0110);
  `has-any-subject` (the workspace holds at least one concept — the guard a
  late wave needs to say "only once the model has substance"; see ADR 0125),
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

## Waves open when the model has substance

A wave may declare `opensWhen`, conditions that must all hold before it opens
([ADR 0125](adr/0125-a-wave-opens-when-the-model-has-substance.md)):

```yaml
waves:
  - id: implementation
    name: Implementation
    opensWhen:
      - condition: has-any-subject
```

A wave that has not opened **asks nothing**. Its questions are not evaluated
at all — rather than evaluated and reported closed, which would say they had
been asked and answered — so they appear in neither the report nor the
summary, and the wave carries `opened: false`. That is the third state a
progress rail needs: neither answered nor open, but not yet applicable.

`summary.questions` therefore counts questions in **opened waves only**. A
blank project reports 3 of 11 rather than 3 of 51, forty-eight of which were
never put; the denominator grows as the model gains substance and waves open.

The gate is about the **model** having substance, never about a previous wave
being answered. A model that has started and declares no work keeps
`implementation-path-missing` open, and that open question is still the model
saying nothing is changing (ADR 0120).

**A closed wave must not be rendered as a finished one.** Both carry no open
questions, and completion inferred from an empty set is the more flattering of
the two readings — a rail computing `done` as `answered === questions` ticks at
zero. `ask` prints `not yet — this wave has not opened` rather than an empty
heading, and a consumer should read `opened` rather than counting. This is
worth stating because both this repository's own renderer and a consuming
product's wave rail had the same fault on the day the gate shipped.

Wave order is load-bearing because of this. A catalogue that sequences
motivation before implementation is making a claim the engine now honours,
where before the order was presentational and questions fired in whatever
order the model happened to trip them.

## A kind a catalogue names must exist where it says it does

A catalogue is refused when it names a kind that its profile is loaded and
does not declare (`YM914`). All three kind-bearing fields are checked: a
question's `trigger`, its `subjects.kinds` selector, and a wave's `opensWhen`
gate.

The failure this prevents leaves nothing visibly wrong. A trigger whose kind
does not resolve never matches, so the question never opens, and that is
indistinguishable from a condition that is simply not met. A selector's kind
scopes the question to an empty set. A gate's kind never holds, and since a
closed wave carries no questions at all, one typo retires a whole wave and
reads exactly like a wave waiting on the model.

**A kind whose profile is not loaded is not an error.** That is a dormant
cross-profile question, and it is a supported thing to write:
`core-enrichment` names four `yarramate/policy@0.1` constraint kinds, and
that profile loads only when a document selects it. Those four questions are
correctly silent in a workspace with no policy, and refusing them would put
four false positives on the shipped catalogue.

The distinction is therefore between a kind that resolves **nowhere the
catalogue could see** and one that resolves in a profile **this workspace did
not load**. Only the first is a mistake. Resolution is tested through the
kind maps rather than a declared-kinds list, so a kind inherited through
`extends` counts: a profile that declares none of its own and inherits every
one is exactly the case a declared-kinds check would call entirely missing.

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
