# A wave opens when the model has substance

Status: accepted

[ADR 0120](0120-the-interview-asks-about-what-is-not-there.md) gave the
catalogue workspace-scoped absence questions, so a layer with zero
subjects could be asked about at all. It argued that an unanswered
presence question is information: an architecture genuinely at rest keeps
`implementation-path-missing` open, and that open question is the model
saying nothing is changing.

That reasoning is right for a model with substance and wrong for an empty
one. Measured on a blank `yarramate init` against 1.3.0's
`core-enrichment@1.2`: **nine questions open, six of them of the form
"you have nothing of kind X"**, including how the planned architecture
becomes real and whether architecture states should be declared. A person
opening an empty model was asked how the planned architecture becomes
real before they had named one subject.

**An empty model is not an architecture at rest. It has not started.** The
catalogue could not tell those apart, so it said the same thing to both.

The first external catalogue author reached the same wall from the other
side, cutting two questions rather than shipping them for exactly this
reason. Between the two catalogues, nine questions were either shipped
unguarded or deleted.

## Decision

**A wave declares `opensWhen`: conditions that must all hold before it
opens.** A wave that has not opened asks nothing.

```yaml
waves:
  - id: implementation
    name: Implementation
    opensWhen:
      - condition: has-any-subject
```

- **The gate belongs to the wave, not the question.** "The implementation
  wave is premature on an empty model" is one fact, not one per question
  in it. A per-question guard makes the right thing *possible* and not
  *default*, and the evidence that authors forget is this decision's own
  history: six questions shipped unguarded here, two cut rather than
  guarded elsewhere. An author who never thinks about cold start still
  gets the right behaviour, because the wave already knows.
- **The gate is written in the condition vocabulary.** `opensWhen` takes
  a condition list, so a reviewer reads a gate exactly as they read a
  trigger, and `has-any-subject` is the only new condition — the one a
  per-question guard would have needed anyway. A minimum-count condition
  can join later without changing the mechanism, so nobody has to pick an
  arbitrary N today to get the fix.
- **A closed wave carries no questions and does not count.** Its
  questions are not evaluated at all, rather than evaluated and reported
  closed: the latter would say they had been asked and answered.
  `summary.questions` counts questions in opened waves only, so a blank
  model reports 3 of 11 rather than 3 of 51 — forty-eight of which were
  never put. The denominator grows as the model gains substance and waves
  open, which is the interview revealing itself rather than a rail
  filling up.
- **A wave reports `opened`, the third state a rail needs.** Neither
  answered nor open: not yet applicable. A consultant can see that an
  Implementation wave exists and is waiting, which excluding it from the
  report would have hidden.
- **The gate is about the MODEL having substance, never about a previous
  wave being answered.** ADR 0120's point survives intact: a model that
  has started and declares no work keeps the question open, and that open
  question is still the model saying nothing is changing.
- **Wave order becomes load-bearing, and that is the point.** Catalogues
  already sequence their waves — motivation before implementation — and a
  rail already shows that order. Until now the order was presentational
  while questions fired in whatever order the model happened to trip
  them. The gate makes the sequencing real, which is what a wave was
  always claiming to be.

  **AMENDED 2026-08-29, and the amendment is the more useful half. The
  sentence above is true only where gates DIFFER, and it was false for the
  catalogue this decision shipped alongside itself.** `core-enrichment`
  gates six of its seven waves on the same `has-any-subject`, so exactly one
  boundary was ever made real — motivation versus everything else — while
  the rail kept drawing six. Worse, four of those six describe a
  precondition in their own prose: `application` "how declared services are
  realized", `technology` "where the declared applications actually run",
  `implementation` "how the planned architecture becomes real", and
  `interaction` closing with "Hygiene waits", a wave stating that another is
  sequenced behind it while both open on the same event. The catalogue
  contradicts itself three lines apart.

  **The rule, which needs no engine support: identical gates are a defect
  exactly when a wave's own description names something a prior wave
  produces.** A description stating an INVARIANT THE WAVE ASSERTS claims no
  sequence and should open simultaneously; one stating a PRECONDITION IT
  DEPENDS ON claims a sequence its gate must then honour. Found by the
  ApertureX adopter, whose own catalogue is clean under this rule for
  precisely that reason, and whose framing this is.

  **No detector is proposed.** The engine cannot know whether an order was
  intended, identical gates can be deliberate grouping, and a refusal would
  therefore be wrong. The author's own description is the evidence, and it is
  checkable by reading.

  **Why nobody saw it**, which is the part worth carrying: when
  `has-any-subject` is the only gate available, every wave after the first
  gets the same one, and a catalogue with six identically-gated waves LOOKS
  ordered — six names, in sequence, on a rail. The author is structurally
  last to notice, because the presentation agrees with their intent rather
  than with the mechanism. CONTRIBUTING.md's ninth rule in a position it had
  not been put: not an allowlist, but a claim true for nobody, its author
  included.

  **Two limits worth stating for anyone re-gating a catalogue.** A gate can
  say "there is something to work on" and can never say "the previous phase
  is finished" — ADR 0120 put the gate on model substance rather than wave
  completion, deliberately, and `interaction`'s "Hygiene waits" is the case
  that wants what does not exist. And a gate naming the subject its own wave
  exists to elicit never opens for the model that needs it: gating
  `implementation` on a `workPackage` would silence the question asking for
  work packages. The gate belongs on what a PRIOR wave produces.

`core-enrichment` goes 1.2 to **1.3**, gating every wave after motivation
on `has-any-subject`. A blank project now opens on three motivation
questions — why the system exists, who its stakeholders are, what
constrains it — and nothing else. It went from 9 open to 3.

`INTERROGATION_SEMANTICS_VERSION` stays at **1**. The engine gained an
optional wave field and a condition; a catalogue that uses neither
evaluates exactly as before, so no existing question's answer moves for
an unchanged model. What changed answers is the *catalogue*, which is
what a catalogue version is for.

## Excluded options

- **A per-question guard** (`has-any-subject` composed into a trigger).
  Cheaper, additive, and it relocates the failure rather than fixing it:
  every future late-wave absence question gets the same coin-flip. The
  author who has just written fourteen questions against this vocabulary
  put it plainly — they would have reached for it on the question in
  front of them and forgotten it on the next one.
- **A minimum-count guard** (`atLeast: N`) as the mechanism. Same
  opt-in weakness, plus it forces an author to pick a number before
  anyone knows what number means anything. It stays available as a
  *condition* under this decision, which is the right layer for it.
- **A per-question override of the wave gate.** Additive and forecloses
  nothing, so it can be added the day a real question needs it. No such
  question exists today: a wave is gated precisely because its questions
  are premature on an empty model, and a question inside it that should
  fire on an empty model is a question in the wrong wave. The failure
  modes are also asymmetric — forgetting to opt *in* is this bug, while
  forgetting to opt *out* leaves a question quieter than intended, which
  is recoverable and visible in review — so the override can never
  recreate what this fixes.
- **Gating on the previous wave being answered.** It would make the
  interview a sequence of locked doors and would destroy ADR 0120's
  standing meaning for a model at rest, whose late waves are open and
  correctly unanswered.
- **Excluding a closed wave from the report entirely.** Cheaper for
  consumers and it hides a real fact: a consultant cannot see that a wave
  exists and is waiting, so the catalogue reads as having fewer waves
  than it does.

## Consequences

The catalogue schema gains an optional `opensWhen`; the report schema a
required `opened` on a wave; the condition vocabulary one member. The
report change is a required field on a published format, so a consumer
constructing a `ReportWave` — a test fixture, most likely — gains it at
typecheck, per the rule in `CONTRIBUTING.md`. Reading is unaffected.

Every existing catalogue behaves identically until it declares a gate.
Models evaluated against `core-enrichment` will see fewer open questions
and a smaller denominator on a young model, and no change at all once
every wave has opened — this repository's own self-model reports the same
51 questions and 0 open as before, because it has substance.
