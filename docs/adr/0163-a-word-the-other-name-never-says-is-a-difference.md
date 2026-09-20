# A word the other name never says is a difference

Status: accepted

Amends ADR 0077, steps 3 and 4. The two tiers, the dismissal, the stemmer,
and "never a `check` error" are untouched.

ADR 0077 removes type nouns so that `order-gateway` and `orders-service`
both reduce to `[order]` and score 1.0. That step is what makes the
motivating example work, and it is also what broke the rule on this
repository's own record.

`visual-session-server-source` and `visual-session-store-source` are two
files. `server` and `store` are both on the shipped type-noun list, so both
were deleted, and what remained on either side was `[visual, session,
source]`: identical, scoring a flat **1.0**. At 1.0 the pair clears the
strong threshold, so the structural corroborator that exists to hold
doubtful pairs back was never consulted. The one word that told the two
files apart was the one word the rule threw away.

The second mechanism is quieter and has the same shape. Step 4 takes the
greater of the token Jaccard and an edit distance over the head tokens
joined by spaces. On `likec4-check-result` beside `likec4-diagnostic-result`
the Jaccard is 0.67 and says the sensible thing; the joined-string distance
is 0.80 and wins, because the two labels share `likec4` and `result` and
those shared characters swamp the one word that disagrees. The more
disciplined a team's naming convention, the more characters its members
share, and so the higher the rule scores subjects that the convention was
written to tell apart.

Across this repository's 383 live concepts the rule flagged 25 pairs and not
one of them was a duplicate.

## What the measurement actually showed, and what it did not

Issue #570 reported 31 pairs, six of them reaching a person through the
shipped `subjects-near-duplicate` question, and called the question's
precision 0 of 6. That was wrong, and the error was in the harness that
filed it, not in the engine. It built identity subjects from every concept,
while the shipped path excludes retired ones (ADR 0064). All six of those
pairs named a retired command. Through the shipped question on this record,
the rule asks **nothing at all**, and did not before this change either.

What survives the correction is narrower and still worth fixing: 25 real
false positives in kinds the shipped question does not name, two of them at
the strong threshold where no corroboration is required. They are invisible
here only because the question names seven kinds and `artifact` is not among
them. An adopter who records files or documents as `dataObject` or
`businessObject`, both of which the question does name, sees all of it.

## Decision

**A type noun is stripped only from the tail of a label.** A role noun
qualifies the name it follows: `order-gateway`, `orders-service`,
`payment-api`. The whole trailing run goes, so `order-api-gateway` still
reduces to `[order]`. A type word anywhere else is part of the name rather
than a label on it, and `visual-session-server-source` keeps all three of
its words.

**Two labels that each say a word the other never says are two subjects.**
Head tokens are paired one to one, strongest first; two tokens correspond
when they are the same word, which is `moderateLexicalThreshold` on the
existing character similarity so that "component" still reaches
"componant". If a token on each side is left unpaired, the pair scores zero
and is never offered, however close the full strings look.

Where nothing is left unpaired on at least one side the score is unchanged
from ADR 0077, so the shapes the rule was built for still fire: the same
words in any order, the same words misspelled, and one label that says
everything the other says and more, which is what a copy looks like
(`payment-batch-processor` beside `payment-batch-processor-v2`).

No threshold moved. Raising the 0.80 floor was the obvious fix and is the
wrong one: it is a number chosen to fit one record, and it would silence the
symptom while leaving a rule that scores a tidy naming convention as
evidence of duplication.

## Consequences

On this repository the flagged set falls from 25 pairs to 8, every survivor
being one label that contains another, and both 1.0 pairs are gone. Nothing
reaching a person changes here, because nothing reached a person.

`INTERROGATION_SEMANTICS_VERSION` moves to **2** (ADR 0106): an unchanged
model can now answer `near-duplicate` differently, and for adopters in the
named kinds it will. A consumer comparing interrogation reports across this
boundary should expect near-duplicate questions to close, never to open.

The fingerprint that guards that promise was not watching this condition.
Its fixture carried a subject called `near-duplicate-component`, named
"Lonely componant" beside "Lonely component", which never fired: the type
noun was stripped from one side and not the misspelled other, so the pair
scored 0.5. A probe that cannot fire pins nothing, which is the precise
failure ADR 0106 was written to prevent. The fixture now carries both a
real duplicate and a family, and the two engines disagree on it.

What this gives up: a pair where **both** labels carry a distinct marker,
`order-gateway-v1` beside `order-gateway-v2`, no longer fires. The commoner
shape of a copy, where one label is the other plus a marker, still does.
That trade is deliberate. The rule spends a person's attention, and on the
only record we can check end to end it was spending it entirely on subjects
that were never the same thing.

The structural corroborator keeps its job and its known weakness: siblings
share an owner *because* they are siblings, so it confirms more often than
it filters. It is no longer load-bearing for the cases that motivated #570,
which now fail the lexical test outright and never reach it. Making it
discriminating would mean weighting an owner by how many subjects it owns,
which makes a pair's verdict depend on the rest of the model rather than on
the pair. That is a larger change to what the rule means and is deliberately
not taken here.
