# A dismissal is a claim too

Status: accepted

From the ontology-mapping exploration (2026-08-05, issue #159): the only
duplicate rules in the engine were exact id collisions, for document ids,
local ids, constraint ids, and reference ids. Nothing noticed that
`order-gateway` and `orders-service` were one subject under two names.
That matters more than a hygiene nit, because Identity is the first thing
the product claims. The pitch says two sessions cannot invent two names
for the same component; what actually enforced that was only that
references must resolve. Two agents modelling the same subject in two
documents produced a clean `check`, a clean `reconcile`, and a silently
forked model.

Decided: a hygiene-wave catalogue question, `subjects-near-duplicate`,
fired by a new deterministic `near-duplicate` trigger condition, and
dismissible by an ordinary claim recorded in the model.

## The algorithm, exactly

No embeddings, no model, no network, no dictionary, no stored state. The
same documents produce the same pairs on every machine, forever.

Candidate pairs are unordered pairs of distinct concepts **of the same
qualified kind**. Kind is the cheapest structural disagreement available,
and bucketing by it bounds the pairwise cost to the square of the largest
kind bucket rather than of the whole model. Architecture states and
retired subjects are already excluded from the interrogation index.

1. **Labels.** `labels(X)` is the local id, the display name, and every
   `aka` entry from ADR 0076.
2. **Normalization.** Insert a boundary between a lowercase or digit
   character and an uppercase one, lowercase, split on every run of
   non-alphanumeric characters, drop empties, then singularize each token:
   `ies` becomes `y`; `sses`, `shes`, `ches`, `xes`, `zes` lose `es`; a
   trailing `s` that is not `ss` is dropped; tokens shorter than four
   characters are left alone. `OrderGateway`, `order-gateway`,
   `order_gateway` and `Order Gateway` all become `[order, gateway]`.
3. **Head tokens.** Remove tokens in a closed, shipped list of type nouns
   (service, component, api, gateway, system, app, application, module,
   platform, server, daemon, worker, engine, store, db, database, cache,
   queue, bus, proxy, adapter, connector, endpoint, svc, srv). If that
   empties the list, keep the original tokens, so a subject genuinely
   called "Gateway" survives.
4. **Label score.** For two labels, the greater of the Jaccard overlap of
   their head-token sets and `1 - levenshtein(a, b) / max(len(a), len(b))`
   over their head tokens joined by single spaces.
5. **Lexical score.** The maximum label score over every pair of labels
   from the two subjects. The maximum, not the mean, because an alias
   exists precisely to be an alternative way in: one label matching is the
   match it was recorded for.
6. **Decision.** The pair fires when the lexical score is at least
   **0.95**, or when it is at least **0.80** and a structural signal
   agrees: the two subjects declare the same owner, or their one-hop
   relationship neighbourhoods intersect.

Step 3 is what makes the motivating example work. `order-gateway` and
`orders-service` share no raw token at all; after singularization and type
noun removal both reduce to `[order]` and score 1.0.

**Why two tiers.** A pair whose head labels are effectively the same
string is worth one question with no further evidence, because that is the
forked-model case verbatim. Between 0.80 and 0.95 lexical resemblance
alone is too noisy to spend a human's attention on, so something
structural must agree first. Below 0.80 nothing fires. The thresholds are
constants in `src/subject-identity.ts`, stated here so that changing them
is visibly a decision.

**The stemmer is crude on purpose.** It turns "status" into "statu". It is
wrong about English regularly, but it is wrong *identically* on both sides
of every comparison, which is the only property a similarity signal
actually needs. Correct morphology means shipping a dictionary, and a
dictionary is versioned state that would have to reopen questions when it
changed.

**Never a `check` error, deliberately.** This is a heuristic about names.
Gating CI on it would fail builds over a judgment call, and would teach
people to rename subjects to appease a linter. `check --strict` still
fails only on evidence contradictions, where a provider looked at reality
and disagreed with the model.

## The dismissal

A false positive must be dismissible, and a dismissal is itself a claim
that needs somewhere to live, or the question reopens on the next run and
the interview becomes a machine for asking a question a human already
answered.

Attestations solved the analogous problem and were the model here: a human
records acceptance in the model, the compiler emits one claim, and the
trigger sees only that the claim exists (ADR 0056). Attestations cannot
express this one, because their arity is wrong. An attestation says
something about one subject; a dismissal says something about a pair, and
the topic field is a kebab-case token that cannot carry a globally
qualified subject id.

Decided: an optional `distinctFrom` list of subject references on
concepts, compiled to `yarramate/identity/distinct-from` reference claims.
The model already expresses binary facts about a concept this way, in
`owner`, `constraints`, `references`, and `presentIn`, so this adds a
predicate rather than a mechanism. Referential integrity applies: an
unresolved reference is `YM310` and a self-reference is `YM311`.

**Read symmetrically.** One recorded judgment closes the pair from either
side. The pair is what the question is about, and demanding the same fact
be written into two documents would be busywork the model should not ask
for, with the added failure mode that half a dismissal is no dismissal.

**No `by` and no `on`, unlike an attestation.** An attestation carries a
date because ADR 0074 built staleness on it: a sign-off covers the wording
it read, and wording changes. Distinctness is not a claim about wording.
Two subjects judged genuinely different do not become the same subject
when one of them is renamed, so a date would imply a staleness semantic
that does not exist and that nothing implements. Provenance is not lost:
every graph-v2 claim already carries its document, path, pointer, line,
and column, and git carries who wrote it and why. Revocation is deletion,
reviewed at the git boundary, exactly as for an attestation.

**No free-text reason field.** Attestations record no rationale either.
The commit message is where "why" belongs, and a required prose field on a
dismissal would mostly collect the word "different".

## Shape of the finding

**The question fires on both members of a pair.** The evaluator is
one-subject-at-a-time by construction, and firing only on the lexically
first member would be worse than untidy: `ask --advise` filters open
questions to the subjects in the requested slice, so a finding recorded
only against one member would silently vanish from a slice seeded on the
other. Answering once closes both, because the dismissal is symmetric.

**The counterpart is named in the rendered question, by qualified id.** A
finding still references exactly one subject. `openSubject` is a closed
shape shared by the interrogation report, the design step, and the advice
projection, and widening all three for a single question is
disproportionate. Naming the counterpart in the question text keeps the
answer actionable anyway, because that qualified id is literally the value
the answer writes back into `distinctFrom`. A new `{counterparts}`
template placeholder does the interpolation, and it is computed only for
questions whose trigger actually uses the condition.

Catalogue version 0.6 becomes **0.7**: a minor bump, which under ADR 0063
may only add questions or loosen triggers. One question is added, no
existing trigger changes, and it records `since: "0.7"` so a model whose
interview was complete can tell "the catalogue deepened" from "the model
regressed".

## Interaction with conservative extension (ADR 0079)

ADR 0079 states two properties: a profile nobody selects changes nothing, and
an extension document is never a worse neighbour than its core twin. A
pairwise condition is the obvious place for the second to break, so it was
measured rather than assumed.

The first property's degenerate case holds, which is the case its test covers
and the one that makes importing a profile safe: an extension profile that no
document selects introduces no subjects, so it creates no pairs and the
catalogue evaluation is byte-identical. The merged property test loads the
bundled catalogue, so it exercises this question directly.

Bucketing by **exact** qualified kind rather than through lineage turns
out to carry more weight than the cost argument that motivated it. An
extension that declares its own kinds, which is the ordinary way to write
one, puts its subjects in their own buckets, where they can never pair
with a core subject that was already there. A near-duplicate arriving as
`example/delivery@1.0#microservice` leaves every
`yarramate/core@0.1#applicationComponent` verdict untouched. Descendant
bucketing would have merged those buckets and made extension documents
routinely reopen questions about subjects they had nothing to do with.

That gap is now pinned as the strictness witness for ADR 0079's second
property: the same arrival under `microservice` leaves a pre-existing
question closed where the same arrival under `applicationComponent` opens it.

The boundary is worth stating plainly rather than claiming more than is
true. When an extension brings a document that declares an *inherited*
core kind, its subject shares a bucket with core subjects, and a genuine
near-duplicate there does open a question about a pre-existing subject.
That is not special to this condition: `concept-isolated`,
`missing-linkage`, `missing-relationship`, and `missing-reference` all
respond the same way to a document that links to a subject already in the
workspace, and they predate this work. Catalogue evaluation is
workspace-scoped by construction. It is also the entire point of #159,
since the failure being detected is two documents describing one subject;
a detector that ignored newly added documents would detect nothing.

## What it said about our own model

Run against this repository's self-model, the question opened on exactly
one pair: `likec4-generated-project-schema` ("Generated LikeC4 project
marker JSON Schema") and `likec4-generated-project-v2-schema`
("Multi-view generated LikeC4 project marker JSON Schema"). Lexical score
roughly 0.91 from the ids, inside the moderate band, corroborated because
both declare the same owner.

That is a true detection and a genuine false positive, which is the
distinction the whole design exists to handle. Both schema files really
exist, one guards single-view generated projects and the other guards
multi-view ones. The threshold was not tuned to make it go away. The
dismissal was recorded in the self-model instead, which is the honest
answer and also the first real use of the mechanism: one `distinctFrom`
entry on the v2 subject closed both findings.
