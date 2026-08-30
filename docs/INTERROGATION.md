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
  `isolated`, `no-subject-of-kind`, `has-subject-of-kind` (workspace: the
  positive twin of `no-subject-of-kind`, for a gate that opens once the
  model HAS something), `no-state-defined`,
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
  `fills-pattern-slot` (the subject is bound into a slot of a pattern
  instance — the membership half of pattern interrogation, ADR 0131. A
  GUARD in the #334 sense: it says a question applies here, and an
  ordinary condition beside it says what would answer it. Bare, it means
  bound into any slot of any instance; optional `patternKinds` narrows by
  the pattern's kind identity — never a document path, the ADR 0129
  naming — and optional `slots` by part name. Instance-level questions
  need no condition at all: a pattern is a kind, and an ordinary
  kind-scoped question already sees every instance. Membership is compile
  CONTEXT rather than graph content, because `parts` binds subjects and
  the expansion stays indistinguishable from a hand-authored graph
  (#268); evaluation reads it from the compilation's
  `patternMemberships`, and a caller of the pure engine that passes none
  gets a condition that never holds — participation unknown, not absent,
  the same rule `unchallenged-evidence` applies to a missing overlay. The
  CLI verbs, the design interview, and the embedded pane all thread it),
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

## A workspace can carry its own questions

A consultancy has a domain catalogue: the questions it asks on every
engagement. An individual engagement raises questions true of that client and
nowhere else, discovered mid-engagement rather than at product-design time.
Those live in the workspace (#345, ADR 0129):

```yaml
format: yarramate/workspace/v1
id: icwa-web
documents: ['documents/**/*.yaml']
questions: ['questions/*.yaml']
```

**Additive.** `questions:` adds to the shipped catalogue; `--catalogue`
replaces the base. Different powers on purpose: a host controls the catalogue
that is not in the workspace, and a consultant adds to it without a release.

**A wave is declared exactly once across the resolved set**, and any catalogue
may contribute questions to a wave it did not declare. So a project catalogue
adds "one more Assurance question for this client" by naming the wave, without
redeclaring it:

```yaml
# the domain catalogue declares the wave, with its gate
waves:
  - id: assurance
    name: Assurance
    opensWhen:
      - condition: has-any-subject
```

```yaml
# the project catalogue just joins it, declaring no wave of its own
waves: []
questions:
  - id: regulator-signoff
    wave: assurance
```

`waves: []` is legal, and is the ordinary shape of a project catalogue. A
catalogue evaluated ALONE with no waves and a question naming one is still
YM911, correctly: nothing declares it.

Declaring the same wave twice is refused (**YM915**). Only a declaration places
a wave in the interview order, so the base's order is untouched and new waves
append. And because there is exactly one declarer, there is never a question
about whose `opensWhen` governs.

**Question ids are qualified as `catalogue#question` in the report.** Authors
write local ids, and the engine qualifies when it composes. Two catalogues may
carry the same local id and stay two distinct questions, so composition needs
no collision rule.

**The identity carries no version**, deliberately. A catalogue version bump
must not strand a judgment someone stored against a question:
`core-enrichment` had three version bumps in a single day, renaming nothing.
Versioned identity is safe for things that are **authored**, because a document
keeps naming the version it was written against and an author updates it
deliberately; it is unsafe for things that are **stored**, because a row in a
database has no author to update it. Versions live beside the identity instead:
the report's `catalogue` names the base, and an optional `catalogues` array
lists every contributor with its version.

Qualification happens when catalogues COMPOSE, not when they evaluate. Every
CLI verb composes even with one catalogue, so ids are qualified from the start
and do not change when a workspace first carries a question of its own. A host
calling `evaluateCatalogue` directly should compose first for the same reason.

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

### A gate asks about the workspace, never about a subject

A gate is evaluated with **no subject**, so only a workspace-scope condition
means anything in `opensWhen`. There are six: `has-any-subject`,
`no-subject-of-kind`, `has-subject-of-kind`, `no-state-defined`,
`exists-linkage` and `unchallenged-evidence`. `exists-linkage` is a positive
existence check, "some concept would satisfy `has-linkage`", which is easy to
miss and often the one a gate wants.

**Do not trust this sentence over the engine.** The set is derived from the
condition union in code, and `YM917`'s own message lists it; a count written
in prose is the thing that goes stale, and this one did — it shipped saying
five and omitting `unchallenged-evidence`.

Any other condition is refused (`YM917`). Before the refusal existed they
loaded silently and split two ways: `has-linkage`, `near-duplicate` and
`fills-pattern-slot` left the wave **permanently shut**, while
`missing-linkage`, `isolated`, `missing-claim` and `missing-constraint` left
the gate **inert**. Both read as a gate to anyone reviewing the YAML, which
is why this is a refusal rather than a finding, and it is the same invisible
failure `YM914` refuses when a gate names a kind that resolves nowhere.

A gate that wants "the model now has X" uses `has-subject-of-kind`
([ADR 0134](adr/0134-a-wave-gate-asks-about-the-workspace-and-may-ask-positively.md)):

```yaml
waves:
  - id: design
    name: Design
    opensWhen:
      - condition: has-subject-of-kind
        kinds:
          - yarramate/core@0.1#applicationInterface
```

`opensWhen` requires every condition to hold and has no `not`, so the
positive and the negative are both needed: a question is closed by an
absence ending, and a gate opens once the thing is there.

Wave order is load-bearing because of this, **but only to the extent that
gates differ**. Waves carrying the same `opensWhen` open at the same instant,
however the rail draws them: they are one phase wearing several labels, and
the engine honours the sequence a catalogue writes only where its gates
distinguish one wave from the next.

**The check, which needs no engine support: identical gates are a defect
exactly when a wave's own description names something a prior wave produces.**
A description that states an *invariant the wave asserts* — "every commitment
has a delivery mechanism" — claims no sequence, and simultaneous opening is
correct for it. A description that states a *precondition it depends on* —
"how declared services are realized" — claims one, and an identical gate
contradicts it in the same file.

`core-enrichment` is the worked example of getting this wrong. It gates six of
its seven waves on `has-any-subject` while four of those waves describe a
precondition: `application` says "how declared services are realized",
`technology` "where the declared applications actually run", `implementation`
"how the planned architecture becomes real", and `interaction` ends "Hygiene
waits" — a wave stating that another is sequenced behind it, while both open
on the same event.

**One thing the vocabulary cannot express, deliberately.** A gate can say
"there is something to work on"; it can never say "the previous phase is
finished". ADR 0120 put the gate on model substance rather than wave
completion, and that decision stands. `interaction`'s "Hygiene waits" is the
case that wants the second, and it has no expression here.

**What the check does not do.** It tests for a *contradiction* between a gate
and a description, not for whether an order exists. Two identically-gated
waves whose descriptions simply claim nothing pass it, and their boundary is
still presentational. A pass means "nothing here disagrees", never "the
sequence is real".

**When choosing a gate, check it against the questions in its own wave.** A
gate naming the subject its wave exists to elicit never opens for the model
that needs it: gating `implementation` on a `workPackage` existing means the
question asking you to declare work packages fires only once you have. The
gate belongs on what a *prior* wave produces.

**And check what the compiler does with it.** A gate can name a fact that is,
after compilation, the same fact its wave's headline question triggers on. In
`core-enrichment`, declaring a `states:` entry mints a `plateau` concept, and
`implementation-path-missing` fires on there being no `workPackage`,
`deliverable` or `plateau` — so gating `implementation` on a declared state
would open the wave at the exact moment its lead question stopped needing to
be asked. Neither the gate nor the description shows this; only the compiled
graph does.

**The construction that avoids all of it: each wave elicits the subject the
next wave gates on.** A catalogue built that way is clean by construction
rather than by audit, and where a gate does name what its own wave elicits,
the remedy is positional — move the eliciting question into the wave in front.
That works for a catalogue ordered by *phase*, where each phase has a
predecessor whose subject matter can carry the question. It does not work for
the first wave in each layer of a catalogue ordered by *layer*, which has no
earlier wave the question would belong to. Such a wave is better left
ungated, and described as not phase-gated, than given a gate that silences
it.

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

## A remedy a question offers must be one some model could author

A catalogue is refused when a trigger offers a relationship the ArchiMate
table forbids (`YM916`, ADR 0133). Both conditions that name a relationship
are checked, each on its own terms: `missing-relationship` against the whole
table, `missing-linkage` against the counterpart kinds it names.

**The unit is the offer, not the question.** A trigger names the ways its
question can be satisfied, and each is an offer: add this relationship, in
this direction, from one of these kinds. A question with three offers and one
dead one still reads as answerable, and is — two of its remedies work. What
happens is that a reader takes the third, authors it, and the compiler refuses
the write. Where every offer is dead the question is also unclosable, which is
the same defect at its limit rather than a separate one.

This is `YM914`'s sibling. `YM914` refuses a question that can never **fire**;
`YM916` refuses one that asks for something nobody could **author**. Both
failures are invisible, and this one twice over: an open question is exactly
what an unenriched model looks like, and a dead offer inside an answerable
question is not visible even then. It surfaces when someone follows it and the
write is refused, at which point the catalogue is the last place anyone looks.

`missing-linkage` is the more checkable of the two conditions, not the less.
`missing-relationship` asks whether any of the 62 core kinds may stand
opposite, a net wide enough that only the seven kinds nothing may realize fall
through it. `missing-linkage` names its own counterpart kinds, so the question
narrows to those: `serving` into an application component is permitted from 37
kinds and from no motivation kind, so an offer naming `[goal, driver]` as
counterparts is dead while the wide check sees nothing wrong.

The check reads the same generated table the compiler admits relationships
against. That is the point rather than an implementation note: a second
encoding of ArchiMate's rules is the defect this refusal exists to catch, and
it is how the consuming product that reported the shape acquired its own
version of the bug — one fact written down in two places, drifting within a
day.

**Every ambiguity resolves toward silence.** A gate that accuses wrongly
implies deleting a working question, so where this one cannot judge, it says
nothing. That is one rule, and it covers four cases. Without a compiled
workspace nothing is reported at all, because an extension kind resolves to
its core ancestor through the kind lineages and there is none to resolve
through. A kind that resolves nowhere is `YM914`'s business. A trigger with
any unresolvable counterpart is skipped whole rather than partially, since a
partial reading could accuse a question a dormant cross-profile kind would
have answered. And `direction: any` or `either` is dead only when **both**
directions are, since either one satisfies the trigger.

A kind the relationship table has no row for is the fourth, and it is the one
that had to be made explicit rather than observed. Every table query answers
an absent kind with an empty set, which reads identically to "this is
forbidden" — the empty-set conflation, sitting where mistaking it turns the
gate into a false accuser on a vocabulary it simply cannot judge. Nothing
reachable through a profile should hit it, since `parent` is required on every
declared kind and resolves to a core ancestor; the check asks anyway, because
that guarantee belongs to another module and a gate should not rest on one
silently. A test pins the guarantee so the change that broke it would say so.

`kindMatching: descendants` needs no special handling: a descendant shares its
core ancestor's row and column in the table, so checking the named kind covers
every kind it matches.

`missing-attestation` and `missing-claim` are not checked. They name no
relationship, so there is no table to consult, and inventing one for them
would be the second encoding this refusal refuses.

## A condition the engine owns defines its own peers

Comparing a subject against its peers is not new here. `near-duplicate` fires
when a subject resembles another closely enough to be the same thing under two
names, so **"what has been said twice" is already a question the vocabulary
can ask.** A proposal to detect peers that have said something twice
*differently* (#399) therefore looks like one step from a condition that
ships, and the step is the whole distance.

Look at what `near-duplicate` takes:

```ts
{ condition: 'near-duplicate' }
```

**No parameters.** Its peer relation is universal, any other subject of the
same kind; its algorithm and thresholds are pinned in ADR 0077; and a
`yarramate/identity/distinct-from` claim removes a dismissed pair upstream in
the index, so the condition itself reads as a plain existence check like every
other. Nothing about it is a catalogue's choice.

A divergence condition as proposed carries a peer selector and a fact
selector:

```yaml
- condition: divergent-binding
  peerVia: ["yarramate/core@0.1#aggregation"]
  kinds: ["yarramate/policy@0.1#authentication-constraint"]
```

Those parameters exist because the peer relation is **not** universal.
Members of one grouping, endpoints of one flow, and subjects of one kind in
one document are all defensible readings, and which one matters is a property
of a particular catalogue's modelling style rather than of the graph. A
condition that has to be told what a peer is is a catalogue's query, and a
vocabulary of parameterized queries is the query language this design has
declined every time it has been asked for.

**So the rule: a cross-peer condition belongs in the engine when its peer
relation holds for every model, and belongs to the host when a catalogue has
to name it.**

That is a measurement path rather than a refusal. A peer relation is
discoverable, and the way to discover it is to build the detector host-side
across more than one catalogue and see what the definition converges to. Two
independent catalogues that turn out to need the same peer relation have found
a universal one, which is what `near-duplicate` had before it shipped.

The dismissal half inherits the same test, and it is the half that matters
more, because a divergence detector with no way to accept a divergence is an
unclosable question wearing a new hat. `distinct-from` works engine-side
because distinctness is a judgment about identity, and every model has
identity. A claim meaning "this divergence is deliberate" would have to name
the peer relation and the fact it covers, so it cannot be specified before the
peer relation is.

## Evaluation model

A question is **open** iff its trigger matches, and **closed** the moment it
no longer does. A subject-scoped question whose selector matches no subject
was **never asked** (#375, ADR 0132): it reports `open: false` with
`asked: false`, and renders as `unasked`, never as `closed` — a host
splitting its answered tally must not count it, because completion inferred
from an empty set is the reading the wave-level "not yet" line already
refuses. `asked` is absent everywhere else and absent means true, so
existing readers keep their meaning. A question is **not applicable** when
any kind it names belongs to a profile that no document in the workspace
has selected (`graph.profiles`). Inapplicable questions are omitted from
the report and from `summary.questions`; they are not `open: false`. Interview state is
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
