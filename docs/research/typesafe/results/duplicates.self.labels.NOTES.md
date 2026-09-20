# Arm 2 labels: draft by the orchestrating session, for the maintainer to confirm

Drafted 2026-09-20 from the candidate sheet alone (names, descriptions, lexical
score, and whether the shipped rule flags the pair). The model's answers for this
arm did not exist when this was written.

**Every pair is `different` but one.** The self-model holds no subject recorded
twice. Every candidate is one of three shapes:

1. Distinct CLI commands that share the "X command" naming convention
   (`Add command` and `Ask command`, `Compare command` and `Compile command`).
   The shipped rule flags six of these nine.
2. Distinct repository files that share a directory or a prefix
   (`session-server.ts` and `session-store.ts`, the fourteen
   `yarramate-visual-*.schema.json` files). 142 of the 151 pairs.
3. One version succession: `yarramate-likec4-generated-project.schema.json` and
   its `-v2`. Labelled `related`, because the protocol's middle level covers
   "one replaces the other". The shipped rule does not flag it.

**Consequence for the registered metric, stated before the answers were read.**
Arm 2's primary metric is precision and recall of `same` against these labels.
With zero `same` labels there are no true positives, so F1 is undefined for the
judgment and for the shipped rule alike, and recall cannot be measured at all.

What the labels can still measure, one-sided:

- **False positives.** The shipped rule raises 31 flags on this record and every
  one is wrong. How many pairs the judgment calls `same` is measurable, and zero
  would mean it silences 31 questions a person would have had to dismiss.
- **The cost of the middle band.** If the judgment puts most of the 151 in
  `related`, it has replaced 31 wrong questions with 151 uncertain ones.

Recall needs a record that actually contains a duplicate. Two ways to get one,
both the maintainer's call: the ApertureX reference (306 subjects, consent not
given), or synthetic twins authored into a copy of the self-model and marked
as synthetic, which is weaker evidence and must be reported separately.
