# A remedy no model could author is refused

Status: accepted

Amended before release (#384). The decision shipped checking only
`missing-relationship`, on the stated ground that the other conditions have
no table to consult. That is true of `missing-attestation` and
`missing-claim` and false of `missing-linkage`, which names its own
counterpart kinds and is therefore MORE checkable, not less. Both defects
in the reporting consumer's catalogue were linkage offers, so the decision
as first written would not have caught the bug that prompted it. The
correction also moves the unit from the question to the offer, and the
title with it; the reasoning below is otherwise unchanged.

`YM914` refuses a catalogue question that names a kind its loaded profile
does not declare, on the reasoning that "the question can never fire". The
sibling case was unguarded: a question that asks for something no model
could author.

A trigger names the ways its question can be satisfied, and each one is an
OFFER: add this relationship, in this direction, from one of these kinds.
The ArchiMate table the compiler admits relationships against decides which
offers are authorable. An offer it forbids is a lie the catalogue tells.

**The unit is the offer, not the question.** A question with three offers
and one dead one still reads as answerable, and is: two of its three
remedies work. What happens is that a reader takes the third, authors it,
and the compiler refuses the write — the reporting consumer lost a
54-operation batch to `YM404` this way, following a question that named
`assignment` among the kinds that could host an application component. A
question-level check calls that catalogue clean. Where every offer is dead
the question is also unclosable, which is the same defect at its limit
rather than a separate one.

The failure is invisible, which is what makes it worth a diagnostic rather
than a report. `YM914`'s failure is invisible because a question that never
fires looks like a condition not met; this one is invisible twice over. An
open question is exactly what an unenriched model looks like, and a dead
offer inside an answerable question is not visible even then — it surfaces
only when someone takes it and the write is refused, at which point the
catalogue is the last place anyone looks. Seven core kinds have no permitted
realization source in ArchiMate 3.2 — `assessment`, `driver`, `gap`,
`implementationEvent`, `meaning`, `value`, `workPackage` — so "nothing
realizes this driver" is unanswerable by construction while looking like
ordinary unfinished work.

`missing-linkage` is the more checkable of the two conditions, which is the
opposite of what this decision first assumed. `missing-relationship` asks
whether any of the 62 core kinds may stand opposite, a net wide enough that
only those seven kinds fall through it. `missing-linkage` names its own
counterpart kinds, so the question narrows to those: `serving` into an
application component is permitted from 37 kinds and from no motivation
kind, so an offer naming `[goal, driver]` as counterparts is dead while the
wide check sees nothing wrong.

Field evidence: an ApertureX session retired a finding of exactly this kind
on 2026-08-28. It fired on `driver`, and it had drifted from their own
catalogue within a day of that ArchiMate fact being recorded in two places.
It surfaced because a consultant looked at the card and found it absurd,
which is not a detection strategy. That session then measured its own
catalogues against the rule (12 triples, none dead, production registry
clean) and argued for the refusal against its own interest, having named
the upgrade break it creates for them.

Decided:

1. **A new `YM916`, raised where `YM914` is raised.** Composition, not
   `check`: `YM914` lives inside `composeCatalogues`, and `check` receives
   it by calling composition like every other caller. One placement
   therefore covers `check`, `design`, `ask --open`, and any host that
   composes catalogues at runtime. That last clause is the point — the
   defect occurred in a registry a consultant edits through a web editor
   with no product release involved, which no test in any repository can
   reach.
2. **The check is derived from the same generated table the compiler
   admits relationships against.** Not a second encoding of ArchiMate's
   rules. Re-encoding that table is the precise defect this decision
   exists to stop, and it is how the reporting consumer's own version of
   this bug happened.
3. **Severity is error, matching every other diagnostic.** The questions
   it refuses were never answerable, so nothing a reader could have acted
   on is lost. A warning was rejected on the reporter's own argument: a
   warning for an invisible defect is a warning nobody reads, and the
   check-result contract has no warning severity to give it.
4. **Every ambiguity resolves toward silence.** `YM914`'s narrowness,
   generalised: a gate that accuses wrongly implies deleting a working
   question, so a miss is cheaper than a false positive here. No
   `profileContext`, no check, because an extension kind resolves to its
   core ancestor through the kind lineages and without a compiled workspace
   there is none. A kind the table has no row for is passed over too, and
   that one is asked explicitly rather than assumed: every table query
   answers an absent kind with an empty set, indistinguishable from
   "forbidden", and nothing reachable through a profile should hit it
   because `parent` is required and resolves to a core ancestor. The check
   asks because that guarantee is another module's to keep.
5. **`any` and `either` close if either direction admits a counterpart.**
   The trigger is satisfied by a relationship in either direction, so an
   offer is dead only when both are.
6. **Both conditions that name a relationship are checked**, and each is
   read on its own terms: `missing-relationship` against the whole table,
   `missing-linkage` against the counterpart kinds it names. A trigger with
   any unresolvable counterpart is skipped whole rather than partially,
   because a partial reading could accuse a question that a dormant
   cross-profile kind would have answered.

Rejected:

- **Staging by source** — hard error for a catalogue loaded fresh,
  tolerated for one already attached. It removes the upgrade break for a
  model mid-engagement, and the reporting consumer offered it. It is also
  more machinery than the problem carries, and it makes the refusal depend
  on when a catalogue arrived rather than on whether it is wrong.
- **A non-error severity.** Larger than this decision: the check-result
  contract states `severity` as a constant, and changing it reopens a
  settled question about what `check` reports versus what `--strict`
  gates. A defect nobody can see is the worst possible first customer for
  a severity nobody has to act on.
- **Widening the check to every trigger condition.** Only
  `missing-relationship` and `missing-linkage` name a relationship the
  table can rule on. `missing-attestation` and `missing-claim` name none,
  so there is no table to consult, and inventing one for them would be the
  second encoding this decision refuses. This is the line the amendment
  moved: it was first drawn one condition too tight, which is worth
  recording because the reasoning was right and the inventory was wrong.
