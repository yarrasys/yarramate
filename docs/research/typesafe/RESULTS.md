# Typed judgments beside the engine: results

Run 2026-09-20 against `jev-1.13.0` on the vendor's API, 11,988 requests,
6.81 M input tokens, US$0.29 at list price; median latency 297 ms, 95th
percentile 380 ms. The request and response bodies are not kept in the
repository: `run-provenance.json` carries the aggregate, `results/` carries
every number quoted here, and re-running the harness with a key regenerates
the rest. Read `PROTOCOL.md` first; it was registered before the first call
and its amendments are dated.

## The second run: a record we did not write

The first run used two records this project authored. On the maintainer's
instruction the ApertureX reference architecture was added, the "Patron
Greeting System": 294 subjects, 479 relationships, 227 of them described, with
its own profiles and its own house conventions. It is the first dataset here
written by someone else for another purpose, and it changes the reading of
arm 1 completely.

| Confidence at least | Self-model 1b | Patron Greeting 1b |
|---|---|---|
| 0.6 | **0.872** (n 336) | **0.534** (n 249) |
| 0.7 | 0.902 | 0.594 |
| 0.8 | 0.929 | 0.676 |
| 0.9 | 0.961 | 0.765 |

Arm 1 without the definitions is worse still on the adopter's record, 0.449 at
confidence 0.6, and it does **not** improve as confidence rises: 0.455 at 0.7,
0.538 at 0.8, 0.500 at 0.9. A flat curve is the signature of being
systematically wrong rather than uncertain. The audit question, which on the
self-model separated agreement from disagreement 0.702 against 0.439, separates
nothing here: 0.529 against 0.550.

**The self-model result was house style, not skill.** Measured against a record
written by the people who wrote the engine, with the engine's own vocabulary
and habits, the judgment looked strong. Measured against an adopter's record it
agrees with the author barely more than half the time. Any product built on the
first number would have shipped on a measurement of ourselves.

The 116 confident disagreements divide into two kinds, and neither is a find:

| Authored, then chosen | Count | What it is |
|---|---|---|
| association → influence | 29 | the adopter's house convention: sign-off and ownership are carried as `association` on purpose |
| assignment → realization | 27 | the same ArchiMate error as on the self-model, component to function |
| assignment → serving | 11 | same family |
| aggregation → association | 9 | model reading a grouping as a loose link |
| association → access | 8 | house convention again |

The first row matters most. The adopter records a stakeholder's sign-off as an
association by design. ArchiMate would often say influence, and the model says
influence 29 times. That disagreement is not a model error and not a record
error; it is a convention the model has no way to know. A suggestion engine
that cannot tell "your house does it differently" from "you made a mistake"
will tell every adopter their record is wrong in their own style.

## Verdict against the registered conditions

| Arm | Registered win | Result | Verdict |
|---|---|---|---|
| 1, relationship kind fit | agreement ≥ 0.85 at confidence ≥ 0.6, and ≥ 1 in 5 confident disagreements are record errors | agreement **0.695** (266 of 533) | **fail** |
| 1b, same with ArchiMate definitions (exploratory) | same | agreement **0.872** (336 of 533); disagreements are the model's convention gaps, not record errors | **fail on the second half** |
| 2, near-duplicates | F1 on `same` beats the shipped rule, and ≥ half the `related` band is related or same | F1 undefined, no positives exist; on false positives the judgment strictly dominates; `related` band is 1 in 21 by label | **fail as written, wins on the measurable half** |
| 3, prose-versus-structure drift | probe recall ≥ 0.7, precision ≥ 0.5 | probe malformed, see below; precision not yet labelled | **not evaluable** |
| 4, ask rerank | top-1 +15 points, honest-empty ≥ 0.8 | top-1 **+34.8 points**, honest-empty **0.889** | **pass** |

On the adopter's record, added after the first run: arm 1 falls to 0.449 and
arm 1b to 0.534, so both fail by a wider margin than on our own records. Arm 2
found no `same` pairs there either, but it did produce a usable `related` band;
see below. Arm 3 flagged 26 of 227 described subjects.

By the registered decision rule, arms 1 and 2 gate the analysis pass and
neither wins, so the analysis pass is not proposed. Arm 4 is a different
feature, it won clearly, and the rule did not cover it; that gap in the
protocol is noted rather than resolved in our favour.

## Arm 1 and 1b: the relationship kind

533 relationships whose endpoint pair permits more than one kind. The authored
kind is hidden, the legal kinds are offered as readings, and the model picks.

| Confidence at least | Arm 1, n | Arm 1, agreement | Arm 1b, n | Arm 1b, agreement |
|---|---|---|---|---|
| any | 533 | 0.557 | 533 | 0.737 |
| 0.5 | 314 | 0.675 | 379 | 0.842 |
| 0.6 | 266 | 0.695 | 336 | 0.872 |
| 0.7 | 205 | 0.756 | 285 | 0.902 |
| 0.8 | 132 | 0.811 | 240 | 0.929 |
| 0.9 | 64 | 0.938 | 179 | 0.961 |

Arm 1's audit question separates: the "does the authored reading fit" Noul
averages 0.702 where the Choice agrees and 0.439 where it disagrees.

**Why arm 1 was weak.** The model reads each option as ordinary English and
picks the plainly true phrase. A technology node does *serve* an application
in ordinary speech; ArchiMate calls it realization. Putting ArchiMate's
meaning beside each reading (arm 1b) recovers 18 points of agreement and
makes more answers confident, 336 against 266.

**Why arm 1b still fails.** 43 confident disagreements remain, and they are
one systematic error, not a set of findings:

| Authored, then chosen | Count |
|---|---|
| assignment → realization | 16 |
| realization → association | 8 |
| realization → serving | 5 |
| serving → association | 4 |
| assignment → serving | 3 |
| everything else | 7 |

"MCP adapter is assigned to Expose the CLI over MCP" is the canonical
ArchiMate shape for a component and the function it performs; the model
prefers realization at p 0.99. An artifact realizing a component is equally
canonical; the model prefers association. The record is right in almost every
case examined. On a 533-relationship record this arm would produce about 43
confident suggestions and find nothing, which is a worse product than no
suggestions at all.

The deeper reading: the ArchiMate table permits several kinds for an aspect
pair, but practice narrows that to one. The convention the model is missing is
knowledge yarramate already holds in its own table and does not currently
express as guidance. That is a finding about the engine, not only about the
model.

## Arm 2: the same subject twice

2,123 candidate pairs at lexical floor 0.6 over 401 subjects.

- The judgment called **zero** pairs `same`.
- The shipped lexical rule raises **31** flags on this record and every one is
  a false positive: precision 0.
- Of those 31, the judgment moves 17 to `different` and 14 to `related`.
- The `related` band is 128 of 2,123, about 6 percent.

**The record has no duplicates.** All nine non-path-named candidates are
distinct commands sharing the "X command" convention; 142 are distinct
repository files; one is a version succession. So recall cannot be measured
here at all, and the registered F1 comparison is undefined for both the
judgment and the rule. That is a property of the dataset, not a result about
the model, and it was written down before this arm's answers were read
(`results/duplicates.self.labels.NOTES.md`).

The `related` band fails its registered condition on the draft labels, 1 of 21
labelled pairs. That draft may be too strict: the judgment puts
`src/adapters/likec4.ts` beside `src/adapters/likec4-export.ts`, which is
defensible as related under the protocol's own wording. The maintainer's
labels decide it.

## Arm 2 on the adopter's record

190 candidate pairs over 294 subjects. The judgment again called **zero** pairs
`same`, and put 19 in `related`. The shipped rule raises 31 flags, of which the
judgment moves 24 to `different` and keeps 7.

Unlike the self-model, this record holds the shapes the middle level was
written for, and the judgment picks them out:

- Five artifacts named "HTTP client → salesforce-patron-api", differing only by
  a parenthetical caller.
- `Expected arrival` beside `Expected_Arrival__c`, a canonical data object and
  its Salesforce representation.
- `Greeting` beside `Greeting view`; `Compose Greeting` beside
  `Compose Greeting View`.
- One pair with **identical names**, `GET /patrons?membershipNumber` recorded
  twice. They are the same operation exposed at two API layers, which is
  correct in an API-led architecture. The judgment called it `related`, not
  `same`, which is the right answer on the hardest-looking case in the set.

It is also incoherent across near-identical pairs: the digest HTTP client
against the base is `related` at 0.85, while the enquiries client against the
same base is `different` at 0.48. Same shape, different answers.

Labels are not drafted for this record. Most of the candidates turn on the
adopter's conventions, not on anything visible in the text: their own notes say
each non-functional placeholder is deliberately carried as its own constraint
subject per layer, which makes `papi throughput` and `xapi throughput` two
subjects by design rather than one recorded twice. Only the adopter can say.
That is itself a finding about the arm: its ground truth is not recoverable
from the record.

## Arm 3: prose versus structure

186 described subjects, 558 questions. 15 subjects flagged: 10 for data, 5 for
a served party, none for a trigger. The distribution is tight, mean noul 0.253,
with 15 of 558 above the 0.7 cut, so the arm is not flagging indiscriminately.

**The recall probe was malformed and its number should not be quoted.** It hid
one edge per subject and asked whether the right question family lit up, but 6
of the 9 hidden edges were `composition` or `realization`, kinds none of the
three questions can ask about. Only 3 were in scope; of those 1 was found, 1
missed at 0.56 just under the cut, 1 missed at 0.36. Three cases decide
nothing. The error is in the harness's own family mapping, registered in
`PROTOCOL.md` and left uncorrected in this run so the record is honest.

Precision on the 15 proposals is not yet labelled.

## Stability

Three repeats of every request, with a marker field so the cache cannot serve
the repeat.

| Arm | Series | Mean s.d. | 95th percentile | Max |
|---|---|---|---|---|
| kind fit, self | 2,189 | 0.0150 | 0.0419 | 0.0953 |
| kind fit with definitions, self | 1,656 | 0.0133 | 0.0455 | 0.1744 |
| near-duplicates, self | 6,369 | 0.0073 | 0.0283 | 0.0668 |
| drift, self | 558 | 0.0099 | 0.0249 | 0.0613 |
| ask, Halcyon | 608 | 0.0038 | 0.0170 | 0.0525 |

This is stable enough to threshold, and matches the vendor's own published
figure of about 0.01. An uncertain band of roughly ±0.05 around any cut would
absorb the drift. One model version answered every request, `jev-1.13.0`.

## Arm 4: free-text ask

32 queries against Halcyon from the website session, 23 with an intended
subject and 9 that the record cannot answer.

| Measure | Substring stage | With rerank |
|---|---|---|
| top-1 hit | 0.435 | **0.783** |
| top-5 hit | 0.870 | 0.870 |

The rerank does not find more; it puts the right subject first. Top-5 is
identical, which says the substring stage's recall was already good and its
ordering was the weakness.

On the nine unanswerable queries, honest-empty was 0.889 overall:

| Batch | n | Honest empty | Returned the named subject: rerank | baseline |
|---|---|---|---|---|
| absent vocabulary | 5 | 1.00 | 0 | 0 |
| present vocabulary, absent property | 4 | 0.75 | **0** | **2** |

The second line is the one that matters. Asked what the meter data platform
costs to run, the baseline hands back the meter data platform; the rerank
hands back nothing. It distinguishes "the record does not hold this subject"
from "the record holds this subject but not this property", which no lexical
stage can.

Caveat the protocol registered: these queries are one non-author session's
guesses at visitor phrasing drawn from the site's own copy, not observed
visitor queries, and their wording deliberately avoids the record's names,
which is the condition under test and also flatters the rerank against a
lexical baseline.

## What we would propose

1. **The ask rerank**, as an opt-in flag, deterministic by default. It is the
   one arm that won as registered, on a second party's queries.
2. **Not the analysis pass.** Arm 1 would produce confident suggestions that
   are wrong about ArchiMate, and arm 2 cannot be shown to find anything on a
   record that contains nothing to find.
3. **A finding for the engine, no model involved:** the shipped near-duplicate
   rule has precision 0 on this record, 31 flags and no duplicates. That is
   worth an issue on its own terms.
4. **Open:** arm 2 recall needs a record that holds a duplicate; arm 3 needs a
   probe that only hides kinds its questions can ask about; the confident
   disagreements of arm 1b and the 15 drift proposals need the maintainer's
   labels before the "finds real errors" half of either condition is settled.
