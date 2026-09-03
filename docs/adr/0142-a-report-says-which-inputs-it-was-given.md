# A report says which inputs it was given

Status: accepted

`asked: false` (#375, ADR 0132) fixed this one level up: a subject-scoped
question whose selector matched nothing reports as never-asked rather than as
answered. **The same fault existed one level down, for INPUTS** (#450, raised by
the ApertureX adopter session).

Several of `evaluateCatalogue`'s parameters are optional, and a condition that
reads one it was not given stays quiet. Quiet is right — the caller did not
look, so the answer is unknown rather than negative — but the report could not
say so, and a quiet condition was byte-identical to a satisfied one:

| condition | input withheld | `open` | `asked` |
|---|---|---|---|
| `unconstrained-kind` | `profileContext` | `false` | **`true`** |
| `unchallenged-evidence` | `evidence` | `false` | **`true`** |
| `fills-pattern-slot` | `patternMemberships` | `false` | **`true`** |
| `missing-part` | `patternVacancies` | `false` | **`true`** |
| *any* | *selector matched nothing* | `false` | `false` |

The last row is the machinery that already existed to say "this was not
evaluated". It just did not cover this cause. So a host summing closed questions
read **"nothing was supplied" as "nothing is missing"**, and for an absence
question like `missing-part` the silent direction is "the interview is
satisfied", which stops an agent working rather than making it do redundant
work. The reporting adopter attributes three shipped bugs to this class.

## Decided

**A required `inputs` map on every report**, saying which optional inputs the
evaluation was given:

```ts
readonly inputs: Readonly<Record<CatalogueInput, boolean>>
```

**Required rather than optional**, on ADR 0110's reasoning for `trigger`: the
fact exists for every report, so an optional field would force every consumer to
write an absent-case branch for a case that cannot occur.

**A separate field rather than a third `asked` value.** `asked` is published, so
a third state is a break; and "no subject matched" and "no data was supplied"
are different facts a host acts on differently.

**Neither the key set nor the condition mapping is hand-written.** Two `Record`s
over closed unions carry it, and both directions are a typecheck error:

- `CONDITION_INPUTS: Record<CatalogueCondition['condition'], CatalogueInput |
  undefined>` — a new **condition** does not compile until it declares which
  input it goes quiet without.
- `inputs: Record<CatalogueInput, boolean>` — a new **input** does not compile
  until the report reports it.

This is CONTRIBUTING's ninth rule applied before the fact rather than after it.
The issue's own proposal named three inputs and there are four; a hand-written
list is exactly the closed enumeration that rule is about, authored by whoever
knew that day's inputs. The same technique is already used twice here, by
`CONDITION_SCOPE` and by `CONDITION_PROBES` in the fingerprint test.

**`conditionInput` is published beside `conditionScope`**, from the barrel and
from `yarramate/interrogation`. Without it the map says "vacancies were not
supplied" and a host still cannot tell *which* of the questions in front of it
that silenced. With it the join is three lines, and that join is what the field
is for.

**The rendered report names a withheld input only when a question in that
catalogue actually reads it.** Derived from (withheld) × (used), not printed
from the map: a line on every report is a line a reader learns to skip, and the
one that mattered would be skipped with it.

## Consequences

- **The report schema is `additionalProperties: false`, so output from this
  version fails validation against a pinned pre-change copy.** ADR 0110 took
  this same cost for `trigger`. The mechanism, now verified with the adopter
  rather than assumed: their contract test compiles the schema **from the
  package**, not from a vendored copy, so it passes on the same bump that ships
  this. The property worth stating is not "nobody validates" but "the validator
  resolves the schema from the package" — those look identical until someone
  vendors a copy.
- **`INTERROGATION_SEMANTICS_VERSION` does not move.** A new report field cannot
  change what an existing question answers, and the fingerprint test confirms it
  rather than the rule being asserted.
- The field-by-field report copier in `ask-command.ts` had to be updated, and
  **the typechecker caught it** because the field is required. Its own comment
  warned that "a copier like this drops a new field silently"; making the field
  optional would have proven that comment right again.

## A second defect this uncovered, fixed here

`yarramate-ask-result.schema.json` **restates** the report's shape rather than
referencing it, with `additionalProperties: false`. That restatement had already
drifted: `catalogues` arrived with composition (#345, ADR 0129) and was never
added, so **`ask --open --json` on a workspace with two catalogues emitted a
report its own published schema rejected.** Shipped, and invisible because every
fixture used one catalogue.

Both fields are added, and a test now asserts the restatement carries every
field the report schema declares — a rule, so the next field cannot repeat the
trick. It fails against the exact drift that was shipped.

The restatement is kept rather than replaced with a cross-file `$ref`,
deliberately: a consumer compiling `yarramate-ask-result.schema.json` standalone
would have to resolve a second schema, which is a break for a fix that the test
already prevents.

## Not decided here

**The same shape exists at load time and is left alone.** `profileContext` is
optional on `loadQuestionCatalogue`, and `YM914` — the guard that refuses a
question that can never fire — is silent without it, so a caller who omits it
gets a catalogue that passed a check that never ran. That is deliberate and
documented ("without one there is no way to tell a typo from a kind whose
profile simply is not here"), and the reasoning still holds. Naming it in the
same family is worth doing; changing it is a separate decision with its own
compatibility cost.

## Excluded options

- **Document only.** Cheapest and consistent with the previous behaviour, but
  the adopter reports three shipped bugs of this class, which is what a
  documented hazard failing to prevent looks like.
- **Extend `asked` to a third state.** A published break, and it conflates two
  facts a host acts on differently.
- **Refuse at evaluation**: a catalogue using a condition whose input was not
  supplied is a caller error. Loudest, closest to `YM914`'s stance, and it would
  break every caller who legitimately evaluates a subset.
- **Per-question rather than per-report.** The fact is per-evaluation; a
  per-question flag repeats one value N times and invites a reader to think it
  varies.
