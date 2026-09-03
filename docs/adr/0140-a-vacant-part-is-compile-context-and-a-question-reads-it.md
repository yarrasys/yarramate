# A vacant part is compile context, and a question reads it

Status: accepted

ADR 0131 gave interrogation the membership half of a pattern: which subject
fills which slot of which instance, so a question can ask the parts something.
The other half never existed. A pattern declares the shape a kind promises
(ADR 0123), an instance that has not bound its parts is a model with known
questions to ask, and there was **no mechanism by which a pattern becomes a
questionnaire** (#447, from the ApertureX adopter session moving its MuleSoft
pack from kind-selected questions to pattern-derived ones).

Measured against 1.17.0 on that adopter's own fixture:

| case | before |
|---|---|
| required part unbound, on an instance declaring `parts` | `YM416` at compile. Enforced, never elicited |
| optional part unbound | compile succeeds, **no question, anywhere** |

The reason was in the engine's input surface rather than in the catalogue
vocabulary. `CataloguePatternMembership` is `{member, slot, instance, pattern}`
and rows exist only for **bound** slots. A vacancy has no `member`, so no
condition over the existing inputs could fire. It needed a new input, not a new
condition over the old ones.

## Decided

**1. The compiler emits vacancy as compile context, beside membership.** A
successful compilation carries `patternVacancies: readonly PatternVacancy[]` —
`{instance, pattern, slot, slotKind, required}`, one row per slot nothing is
bound into, `pattern` being the kind identity ADR 0129 chose. Derived from the
loop that already walks `pattern.slots.values()` for `YM416`, so it costs
almost nothing. The serialized graph does not change by a byte, for the reason
ADR 0131 gives: an author cannot write a vacancy claim, and a graph carrying
claims no author could write is the distinguishability #268 refused.

Deliberately **not** widening `patternMemberships` by making `member` optional.
That is a reader break for everyone destructuring it (CONTRIBUTING's first
rule; `ResolvedWorkspace.patterns` broke an adopter's production module the
last time this was tempting).

**2. A new trigger condition, `missing-part`, scope `subject`, subject = the
INSTANCE.** The mirror of `fills-pattern-slot` in every respect that could
otherwise become a trap: bare it means "some part of this instance's pattern is
unbound", `patternKinds` and `slots` narrow it, and an absent input stays
**quiet** rather than reading as "no vacancies" — the rule ADR 0131 recorded
for absent memberships and `unchallenged-evidence` for an absent overlay. A
mirror condition with a non-mirrored default is a trap.

The subject is the instance because the absent member has no id to be a subject
with. One question therefore yields one entry per instance, and per-part
granularity is a catalogue-authoring choice: an author wanting a question per
part writes one question per part with `slots: [service]`, which is what they
want anyway, because each part deserves its own text and materiality. That also
satisfies the answer-shape requirement **with no new report field** — the
report already echoes the trigger verbatim, and a per-part question's trigger
already names the part. The part's KIND stays out of the report: a host joins
`(instance, slot)` against `patternVacancies` and reads `slotKind` there, so
pattern data lives in one place rather than in a second where it can drift.

**3. An instance that declares no `parts` at all is asked about every part,
and that is the substance of this ADR rather than a detail of it.**

`compiler.ts` collects a `PatternInstance` only `if (concept.parts !==
undefined)`. A concept whose kind has a pattern but which declares no parts is
therefore not an instance: nothing is collected, nothing is expanded, and
**`YM416` never fires**, so it compiles clean with the entire template blank.
`parts: {}` is not an escape either — the schema requires at least one
property, so an author cannot opt in.

That is precisely the greenfield instance ADR 0123 named and left to a later
phase ("an instance that binds nothing is exactly the greenfield case"), it is
the adoption starting point, and it is the instance with the most to ask. The
first draft of this design derived vacancies from `patternInstances` alone,
which would have reported `[]` for it — and `[]` means *fully bound*. A feature
whose entire purpose is to surface unanswered questions would have reported the
emptiest model in the workspace as the most finished one, which is
CONTRIBUTING's "an empty set is not a finished one" arriving at the very
surface this ADR creates.

So vacancies are derived from **both** the collected instances and a parallel
list of concepts whose kind has a pattern and which declare no parts.

**Instance-hood for the purpose of being ASKED is a wider question than
instance-hood for the purpose of being EXPANDED,** and the two lists are kept
apart deliberately. Adding the greenfield instances to `patternInstances` would
start firing `YM416` on them, which would refuse workspaces that compile today,
including an adopter's live engagement project. Nothing that compiles before
this change stops compiling.

**4. `required` is on the row after all.** The first draft omitted it, arguing
that on a successful compile every vacancy is optional by construction, since a
required slot left unbound is `YM416` — so the field would be permanently
`false`, "a lie waiting to be trusted". That argument is true only of an
instance that declares `parts`. The greenfield instance never reaches `YM416`
and compiles with its required parts vacant, so the flag is load-bearing: it is
the difference between "you have not decided this yet" and "this model does not
stand up without it", which are different questions to put to a person. The
condition itself does not read it; a catalogue that wants only one of them says
so with `slots`.

**5. `INTERROGATION_SEMANTICS_VERSION` does not move,** and this is an enforced
rule rather than a judgement: `src/interrogate-command.ts` says to bump it when
an existing question's answer can change for an unchanged model and "not for a
new condition". Confirmed by measurement rather than by reading the rule —
excluding the new probe's own answer, the fingerprint in
`test/interrogation-semantics.test.ts` is byte-identical to the shipped
`1ef7dc086fdde597`. Only `EXPECTED_FINGERPRINT` changes.

## Consequences

- Every evaluation site threads `compilation.patternVacancies`, exactly as it
  threads memberships, and an unthreaded one fails **silently** — the question
  simply never fires. So every mode gets its own assertion in
  `test/missing-part.test.ts` rather than one test standing in for the family.
  This is ADR 0131's lesson, paid a second time.
- `patternKinds` is **defence in depth, not the thing that scopes the
  question**, and the docs say so. Measured: with a subject selector naming one
  kind, removing `patternKinds` leaks nothing, because a kind has at most one
  pattern (`YM411`) and so the selector already pins it; and a subject-scoped
  question cannot omit `subjects` at all. The facet earns its place only where
  the selector is broader — several kinds listed, or `kindMatching:
  descendants`. Without that written down, authors would duplicate a kind
  identity in two places for no benefit and give it somewhere to drift.
- A `patternKinds` entry is a kind reference wherever it appears, so it joins
  `YM914` validation by field name rather than by condition, and a mistyped
  identity is refused rather than silently never firing.
- Adding `patternVacancies` to `CompilationResult` breaks a whole-result
  `toEqual`, which is the readers-versus-constructors rule surfacing in a test
  rather than in a consumer. Readers using `?? []` are unaffected.
- **A report still cannot say a condition was never evaluated.** A caller that
  forgets to thread `patternVacancies` gets questions reporting `open: false`
  with `asked` absent, byte-identical to answered ones, so a host summing
  closed questions reads "nothing was supplied" as "nothing is missing". That
  is pre-existing — `fills-pattern-slot` has behaved this way since ADR 0131 —
  but it bites harder here, because a `missing-part` question is *about
  absence*, so the silent failure direction is "the interview is satisfied".
  Split to **#450** deliberately: it is about what `asked` means, `asked` is
  published, and bundling a published-shape change inside a feature addition is
  how both go unreviewed.

## Excluded options

- **Making the greenfield instance a compile error** (stop keying instance-hood
  off `parts`, so a bare concept of a pattern kind is refused for its required
  parts). Arguably what should have happened in ADR 0123, and it would keep
  `required` off the row. Refused because it breaks builds that pass today,
  including an adopter's live engagement project, and this feature is not the
  place to spend that. The gap is now visible in the interview instead, which
  is the outcome that was wanted from it anyway.
- **Shipping without the greenfield instance**, exactly as first specified.
  Cheapest, and it was the accepted shape, but the pattern would not become a
  questionnaire until the author had already bound one part by hand, and the
  emptiest instance would report as the most finished one.
- **A `required` facet on the condition.** Nobody asked for it, `slots` already
  expresses the narrowing an author actually wants, and a facet added on
  speculation is one more thing a mirror has to mirror.
- **Putting `slotKind` in the report.** It duplicates pattern data into a
  second place where it can drift from the pattern document. The host joins to
  the vacancy row from the same compile result it already reads memberships
  from.
