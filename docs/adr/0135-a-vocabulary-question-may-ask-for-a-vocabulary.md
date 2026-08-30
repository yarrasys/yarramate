# A vocabulary question may ask for a vocabulary

Status: accepted

From ApertureX (#411), against 1.12.0, with two field cases from a live
MuleSoft engagement rather than a hypothetical.

## The defect

A **vocabulary question** asks a workspace to declare the terms that later
per-subject questions resolve against: which API-led layers exist, which data
sensitivity classes, which integration styles. The only condition able to ask
was `no-subject-of-kind`, which is satisfied by **one** instance. So the
question closed the moment any single term existed, and a one-term vocabulary
was indistinguishable from a complete one.

Both reported cases are worth keeping, because they fail differently.

**Born satisfied by incidental content.** A consultant authored one
`sensitivity-class` ("Confidential") at model v4 to answer a per-object
classification question. The vocabulary question was attached four versions
later and had already been satisfied by that single class. It never appeared.
The cost surfaced seven versions on, when a second data object arrived and
could only point at "Confidential", which a human recognised as wrong.

**The same shape with no forcing function.** `integration-style` closed after
one style. Every interface on that engagement genuinely is request-reply, so
nothing will ever point at the vocabulary and disagree. The single entry sits
there looking declared indefinitely. This is the worse case: the first
self-corrected by accident and this one cannot.

## Why the catalogue could not fix it

The obvious remedy is to reword only the vocabulary questions that lack a
per-subject consumer able to challenge them. The adopter measured that across
both their catalogues: **all five vocabularies have a consumer, including both
that failed.** The rule selects nothing.

The actual discriminator is whether the estate contains two things needing
different classifications, which is a property of the engagement rather than
of the catalogue. It is invisible at authoring time, at compose time, and at
the moment the question fires, because the model then usually holds nothing to
classify yet. So there is no catalogue-side rule, and the adopter's fallback
was to reword all five questions to stop over-claiming: "Has this platform
declared its API-led layers?" rather than "Which API-led layers does this
platform use?". Honest, and a worse question.

## Decision

`below-subject-count`, workspace-scope, fires while fewer than `atLeast`
subjects of the named kinds exist. `no-subject-of-kind` is its `atLeast: 1`
case, so the existing condition is the degenerate form of this one.

`kindMatching` behaves as everywhere else, `descendants` by default. This is
load-bearing rather than incidental: the adopter's `sensitivity-class` is a
`grouping` specialization, and a catalogue naming the core kind has to count
the specialization.

The answer shape is the `add-concept` that `no-subject-of-kind` already
produces, so nothing downstream learns a new remedy. Nothing today can express
this, so no existing catalogue changes meaning and the addition is not
breaking. Per ADR 0106 the interrogation semantics version does not move: a
new condition changes no existing question's answer, and that was verified by
reproducing the previous fingerprint from the unchanged probes.

## `atLeast` must be at least 2, and the refusal says why

`YM918` refuses a smaller threshold, in two layers.

`atLeast: 0` is refused **structurally** by the schema (`minimum: 1`): a count
can never fall below zero, so the question could never fire, which is
`YM914`'s defect arriving through arithmetic. The engine's guard is `< 2`
rather than `=== 1` so a host composing a catalogue programmatically cannot
slip past the schema layer.

`atLeast: 1` is well-formed and means something the vocabulary already says,
which no schema can know. `YM918` names `no-subject-of-kind` rather than
stating a bound, because an author who wrote `atLeast: 1` did not make an
arithmetic mistake. They wanted the condition that already exists.

## What this is not

A general numeric comparison vocabulary. A kind's population against a floor
is the whole need. The narrow condition is the same trade that kept
`has-subject-of-kind` a twin rather than a predicate, and it is the trade
recorded one issue over in "a condition the engine owns defines its own
peers": a vocabulary of parameterised comparisons is a query language, and
this design declines those. `atLeast` is a threshold on a count the engine
already computes, not a selector the catalogue gets to define.

## The backstop this exposed

`test/interrogation-semantics.test.ts` claimed to exercise "every condition the
engine understands" and missed two, `has-subject-of-kind` and
`fills-pattern-slot`, because it compared its own list against itself. Both had
arrived after it was written.

The probes are now a `Record<CatalogueCondition['condition'], …>`, the same
technique ADR 0134 applied to `CONDITION_SCOPE`: a new member of the union is
a compile error until it is given a probe, so the backstop cannot fall behind
the engine it backstops. This is `CONTRIBUTING.md`'s ninth rule, and the
failure was the rule's own prediction: an allowlist cannot fail for the author
who wrote it.
