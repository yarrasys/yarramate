# A predicate is not an authoring gesture

Status: accepted

From ApertureX (#430), filed after they decided **not** to use `missing-claim`
because of this.

## The report

Their answer-shape mapping, the consumer half of ADR 0110, turns a trigger
into a one-click affordance and covered five conditions:

```
no-subject-of-kind                     -> add-concept
missing-relationship / missing-linkage -> add-relationship
missing-constraint                     -> add-constraint
missing-attestation                    -> record-attestation
```

`missing-claim` mapped to nothing, so a question using it rendered as prose:
the card states the problem and the consultant goes and finds the editor. Their
pack has a test asserting **no card degrades to prose** across 42 questions, so
adopting it meant either breaking that guarantee or shipping the one card that
behaves differently from every other. They shipped neither, and the ownership
column stayed workbook-filled while the interview never asked who owns a
component.

## Why it mapped to nothing, which is the part worth stating

`missing-claim` matches a **raw predicate**, and a predicate is not an
authoring gesture. `yarramate/attestation/adequacy` is written by adding an
attestation. `yarramate/reference/refers-to` by adding a reference.
`yarramate/constraint/requires` by adding a constraint binding. And a profile
may mint predicates this engine has never heard of.

So the condition cannot map onto one operation **in general**, and ADR 0110's
rule is that a skeleton is printed only where the mapping is unambiguous,
because a wrong skeleton is never offered.

## Decision

Three predicates map, and only three: `yarramate/ownership/owner`,
`yarramate/concept/description` and `yarramate/lifecycle/status`. Each names a
field on a concept that `update-concept` writes directly, so each is
unambiguous. Everything else prints nothing, exactly as before.

This is the **"one new mapping case" ADR 0110 anticipated**, not the normalized
remedy DSL it excluded. No second vocabulary is introduced, nothing is added to
the report envelope, and the trigger still travels verbatim.

Those three happen to be **every `missing-claim` the shipped catalogue uses**:
`owner-missing`, `information-unowned`, `concept-undescribed` and
`status-missing`. The gap the adopter met from outside, the CLI had from
inside, on four of its own questions.

## What is NOT decided

**The engine takes no position on which predicates a HOST should render as
editable.** That was the adopter's own hesitation about their option 1 and it
is right: the trigger carries the predicate, and a host decides what control to
draw. This change is the CLI rendering its own affordance, the same as its
other two cases, and it does not reach into a consumer's mapping.

An adopter wanting the same coverage reads the predicate off the trigger, which
ADR 0110 already puts there, and maps it to their own field control. What they
were missing was the statement that `missing-claim` is a predicate match rather
than a gesture, so the mapping is theirs to make and to bound.

## Keeping it honest

A test asserts the mapping covers every `missing-claim` predicate the shipped
catalogue uses. The catalogue is the thing that changes; a question arriving on
an unmapped predicate now fails a test, so the author extends the mapping or
accepts prose deliberately, rather than an adopter discovering it from a
shapeless card.
