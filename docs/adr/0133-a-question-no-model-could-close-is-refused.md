# A question no model could close is refused

Status: accepted

`YM914` refuses a catalogue question that names a kind its loaded profile
does not declare, on the reasoning that "the question can never fire". The
sibling case was unguarded: a question that can never be CLOSED.

A `missing-relationship` trigger asks its reader to add a relationship. The
ArchiMate table the compiler admits relationships against decides which
kinds may hold which relationship to which. Where that table permits no
counterpart at all for the triple a trigger names, the question reports a
gap the standard forbids filling. It opens on every matching subject,
stays open forever, and reads as the model's fault rather than the
catalogue's.

The failure is invisible, which is what makes it worth a diagnostic rather
than a report. `YM914`'s failure is invisible because a question that never
fires looks like a condition not met; this one is invisible because an open
question is exactly what an unenriched model looks like. Seven core kinds
have no permitted realization source in ArchiMate 3.2 — `assessment`,
`driver`, `gap`, `implementationEvent`, `meaning`, `value`, `workPackage` —
so "nothing realizes this driver" is unanswerable by construction while
looking like ordinary unfinished work.

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
4. **No `profileContext`, no check** — `YM914`'s rule, inherited
   unchanged. An extension kind resolves to its core ancestor through the
   kind lineages, and without a compiled workspace there is no lineage to
   resolve it through. Guessing would be the false positive the narrowness
   exists to avoid.
5. **`any` closes if either direction admits a counterpart.** The trigger
   is satisfied by a relationship in either direction, so it is unclosable
   only when both are empty.

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
  `missing-relationship` names a triple the relationship table can rule
  on. `missing-attestation` and `missing-field` have no table to consult,
  and inventing one for them would be the second encoding this decision
  refuses.
