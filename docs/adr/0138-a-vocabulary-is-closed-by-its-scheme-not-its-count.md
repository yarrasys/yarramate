# A vocabulary is closed by its scheme, not its count

Status: accepted

From ApertureX (#436), field evidence on `below-subject-count` after adopting
it across six vocabulary questions on a live engagement. The condition works:
it caught two pieces of genuinely incidental vocabulary within days. The
finding is that what it says is one step short of what the question means.

## The two reports, which are one defect

**The count is satisfied by exactly the behaviour it exists to prevent.**
Anyone who wants the question gone adds a second value, and the trigger cannot
tell a surveyed estate of two from a surveyed estate of one plus a throwaway.

**When the truth is one, no agent can close it.** A single-plane estate is
real; saying so is a dismissal, and dismissal is host-side and human-only. So
a CORRECT model carries a permanently open question. Measured: 2 of 19 open
questions on the reporting engagement, both against a model that is right.

These look opposite and are the same defect. **A threshold cannot be both
harder to reach dishonestly and easier to reach honestly**, because the count
is a proxy: the question means "was this surveyed", and the count measures
"how many exist". No value of `atLeast` closes the gap between them. The
reporter named it exactly: *the count is the container, the survey is the
answer, and counting the container does not reach it.*

## The frame that decides it

This is not a dismissal problem. `docs/MODEL-FLOOR.md` states the rule it
breaks:

> **Whatever the interrogation asks about must be recordable as an answer.**

The question asks *"which sensitivity classes does this platform recognise?"*.
For a single-class platform the complete answer is *"one, Confidential, and
that is the whole scheme."* The model records that Confidential **exists**. It
cannot record that the scheme is **complete**. Those are different facts and
only the first is expressible, so the honest answer has nowhere to go.

That reframe settles the fork the issue leaves open. A surveyed marker the
condition consults is a second encoding of a fact the model should hold, which
is the risk the reporter named against their own sketch. Letting an agent
record a dismissal touches authority semantics. Neither is needed: **make the
answer recordable, and an ordinary condition closes on it.**

## The mechanism, in vocabulary that already exists

`MODEL-FLOOR.md` already prescribes the form: a classification axis is **a
`grouping` that aggregates its members**. A scheme subject aggregating its
classes IS the statement "these are the classes, and this is the set". No new
value type, no new claim, no floor decision.

Verified legal against the ArchiMate table: a `grouping` may aggregate a
`grouping`, so a scheme may aggregate classes that are themselves grouping
specializations, which is how the reporting adopter models them.

The vocabulary question then asks for the scheme rather than the tally:

| model state | count test | scheme test |
|---|---|---|
| no classes | open | open |
| one class, authored incidentally | open | open |
| **two classes, both incidental** | **CLOSED** | **open** |
| **one class, scheme declared** | **open** | **CLOSED** |
| two classes, scheme declared | closed | closed |

Both reported problems close at once, and neither by tuning a number. The
throwaway-second-value escape disappears because the closer is a declaration,
not a count.

## Validated before proposing, with no engine change

The truth table above is not reasoning. `exists-linkage` is the positive of
the condition this proposes, and it already ships, so the four states can be
probed today. Against a probe catalogue triggering on
`exists-linkage(aggregation -> grouping)`:

| model state | `exists-linkage` |
|---|---|
| no classes | quiet |
| one class, authored incidentally | quiet |
| two classes, both incidental | quiet |
| one class + scheme declared | **fires** |

It fires in exactly one of the four, and it is the one where the vocabulary
question should close. So the negation is correct by construction, and the
proposed condition is `exists-linkage` inverted rather than new behaviour that
has to be argued for.

## What is missing: one condition

Workspace-scope linkage has only the positive.

| condition | scope |
|---|---|
| `exists-linkage` | workspace |
| `has-linkage` | subject |
| `missing-linkage` | subject |

A question is open while its trigger holds, so asking "no scheme aggregates
any class" needs the **negative twin of `exists-linkage`**, which does not
exist. This is the same gap `has-subject-of-kind` filled for
`no-subject-of-kind` in #398, one family over.

```yaml
trigger:
  - condition: no-linkage-exists
    kinds: ["yarramate/core@0.1#aggregation"]
    direction: outgoing
    counterpartKinds: ["aperturex/consulting@1.0#sensitivity-class"]
```

Workspace scope, so it is legal in a wave gate. Same shape as `exists-linkage`
and the same evaluator, negated.

## What this does NOT do to `below-subject-count`

It does not deprecate it. "The model holds fewer than N of this kind" remains
a legitimate thing to ask, and the adopter's balance note is worth carrying:
two remains the smallest number that cannot be reached by accident, the
condition caught real incidental vocabulary within days, and they would adopt
it again.

What changes is the guidance. `below-subject-count` measures a population.
**A vocabulary question is not asking about a population, it is asking whether
someone surveyed**, and the scheme is where that answer lives.

## Cost, stated plainly

**Adopters author one scheme subject per vocabulary.** Six for the reporting
adopter. That is more model, and it is the honest more: the scheme is a real
thing with a name that was previously implicit in a set of loose subjects.

**The first answer gets longer.** Closing a vocabulary from empty now means
authoring a scheme and a member rather than a member alone. This is the
sharpest objection to this design and it should be weighed rather than waved
past.

**The shipped catalogue pays nothing.** `core-enrichment` uses
`below-subject-count` zero times, and its thirteen workspace
`no-subject-of-kind` questions are layer-presence questions (#272, ADR 0120),
not vocabularies: they ask whether a layer exists at all, where one instance
genuinely is the answer. The reporting adopter drew the same distinction
unprompted about their own interfaces question. So nothing migrates here, and
this is additive for adopters.

## Alternatives considered

**Count AND no-scheme, as a two-condition trigger.** Expressible today once
the new condition exists, and it fixes the honest single-value case while
leaving the throwaway escape open, because two incidental values still close
it. Cheaper migration, half the fix.

**A `surveyed` marker the condition consults.** The reporter's first sketch
and their own stated concern: a second encoding of a fact the model should
already hold, with the added failure that nothing would stop the marker being
authored on an unsurveyed vocabulary.

**Letting an agent record a dismissal.** Their second sketch. Moves authority
semantics to solve a modelling gap, and dismissal is correctly human-only in
their product.

## Settled by the maintainer

The extra scheme subject is a fair ask, `MODEL-FLOOR.md` already prescribing
the form. The condition is `no-linkage-exists`. The guidance change goes in
`docs/INTERROGATION.md` beside `below-subject-count`, which is the second thing
that section says about a condition shipped a day earlier, and that is the
honest record rather than an embarrassment to manage.

## One thing building it taught

The first fixture used a bare `grouping` for both the scheme and its classes,
and the scheme then counted as one of its own members — so `below-subject-count`
CLOSED on a correctly modelled single-class vocabulary, by accident, for the
wrong reason. It looked like the design working and was the fixture lying.

Modelled the way an adopter actually does it, with the classes as a profile
specialization and the scheme a plain grouping above them, the row behaves as
designed. A test that conflates the container with its contents will agree with
whatever it is asked, which is the same shape of error as counting the
container in the first place.
