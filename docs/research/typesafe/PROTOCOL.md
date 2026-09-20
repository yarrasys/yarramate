# Typed judgments beside the engine: pre-registration

Status: registered 2026-09-20, before any model call. Amend by adding a dated
note under "Amendments"; never edit a registered number in place.

## Question

Does a calibrated decision model (TypeSafe's Jev, System One) add value to
yarramate's model analysis and interview, as a proposal layer outside the
engine, on the record sizes yarramate adopters actually have?

The engine is not under test. Nothing in `check`, `compile`, `apply`, the
workbook merge or the interrogation semantics changes in any arm. What is
under test is whether four bounded judgments over material the engine already
computes are accurate and stable enough to show a person as suggestions.

## Model, endpoint, pins

- Model `jev-1.13.0`, pinned by version in the client, never the alias.
  The response's `model` field is stored with every answer.
- Endpoint: the vendor's `POST /v1/systemone`, direct, with a key in
  `TYPESAFE_API_KEY`. The Cloudflare AI Gateway path is a production
  question, parked until these results exist.
- Every request and response is cached under `cache/` by request hash; a
  finished arm replays with no calls. Repeats add a `run_marker` field to the
  state so the hashes differ, the way the vendor's own consistency cookbook
  adds a fresh `uid`.
- Concurrency 4; the vendor's cookbooks report throttling above about 8.
- Cost ceiling: US$2 for the whole study. One pass of every arm on both
  bundled datasets plans at about 3,400 requests and 0.84 M tokens
  (about US$0.04 at list price); three repeats for stability, about US$0.11.

## Datasets, frozen

| Name | What | Frozen at | Subjects / relationships | May leave the machine |
|---|---|---|---|---|
| `self` | yarramate's own record, `.yarramate/` | tag v1.35.0, `94e914c` | 401 / 539 | yes, public |
| `halcyon` | the site's showcase, copied read-only | site `ac29f3f`, showcase commit `c6e5bd0` | 18 / 14 | yes, public |
| `patron-greeting` | ApertureX's reference architecture, the "Patron Greeting System" | apx `dbbf549`, copied 2026-09-20 | 294 / 479 | yes, on the maintainer's instruction; placeholders throughout, no real personal data |

The self-model is the primary set; Halcyon is a small second set that a
visitor to the site would meet.

- 2026-09-20, after the first run and on the maintainer's instruction, the
  ApertureX reference is added as `patron-greeting`. It matters because the
  first run could not measure two things: arm 2 had no duplicates to find in
  the self-model, and every dataset so far was authored by the same hands that
  wrote the engine. This one is a consulting engagement's shape, 87 constraints
  and 57 application functions among 294 subjects, authored by an adopter for a
  different purpose. Its arm 2 result is the one that can carry recall, and its
  arm 1 result is the first on a record this project did not write. Every
  number from it is reported beside the self-model's, never pooled.

## Arms, metrics, and what counts as a win

Every threshold below is also the constant in `harness/arms.mjs`; the file is
the registration.

### Arm 1: the relationship kind fits the meaning (primary)

For every relationship whose endpoints resolve to core kinds and whose pair
permits more than one kind: hide the authored kind, offer the legal kinds for
the pair as readings ("Portal serves Patron"), and ask one Choice with the two
descriptions as state. A second request, with the authored reading in state,
asks one Noul: does the authored reading fit.

Skipped and counted: pairs the table permits only `association` for,
responsibility edges (their reading is fixed by the kind), and any authored
kind outside the legal set.

- Primary metric: agreement of the blind Choice with the authored kind,
  among answers with confidence at or above 0.6. Also reported at 0.5, 0.7,
  0.8, 0.9 and for all answers.
- Secondary: the audit Noul's mean on agreeing versus disagreeing edges.
- Every confident disagreement is read by the maintainer and labelled
  `model-wrong`, `record-wrong`, or `both-defensible`.
- Win: agreement at or above 0.85 among confident answers, and at least one
  in five confident disagreements labelled `record-wrong`. Both, because a
  model that agrees with everything finds nothing, and one that disagrees
  with everything is noise.
- Expected failure mode, stated now: `serving` versus `flow` versus
  `triggering` between behaviour subjects, where the descriptions do not say
  which. Those may land in `both-defensible`.

### Arm 2: the same subject twice

Candidate pairs: same qualified kind, lexical score at or above 0.6 on the
engine's own `lexicalScore`, not already `distinctFrom`. One Score per pair
with three described levels: different things; related and a person should
decide; the same thing recorded twice. Level is the rounded score.

Labels: the maintainer labels a sheet of 151 pairs from the self-model, drawn
by `run.mjs labels`: every pair the shipped rule flags today (31), the 60
strongest lexical candidates it does not, and 60 drawn at random from the
rest with a fixed seed. Labels are `same`, `related`, `different`, given
before seeing any model answer.

- Metric: precision and recall of the judgment's `same` against the labels,
  beside the shipped rule's precision and recall on the same pairs.
- Also reported: the composition of the `related` band by label.
- Win: the judgment's F1 on `same` exceeds the shipped rule's, and at least
  half of the `related` band is labelled `related` or `same`. A large
  `related` band full of `different` is a cost, not a feature.

### Arm 3: prose says more than the structure holds

For every subject with a description of 40 characters or more: state is the
subject and its recorded relationships as readings; three Nouls ask whether
the description names data, a served party, or a trigger that the
relationships do not already cover. A Noul at or above 0.7 is a proposal.

- Recall probe (`--probe`): for each subject whose description names a linked
  counterpart by name, hide that edge and ask; recall is the share of hidden
  edges whose family (data, served, trigger) is flagged. The self-model has
  only 9 such subjects; this probe is indicative, not decisive, and is
  registered as such.
- Precision: the maintainer reads the proposals on the self-model, up to 30
  drawn in id order, and labels each `accept`, `reject`, `unclear`.
- Win: probe recall at or above 0.7 on the 9, and precision at or above 0.5
  on the reviewed proposals.

### Arm 4: free-text ask finds what was meant

Queries live in `datasets/ask-queries.<dataset>.json` as
`{ query, intended: [subject ids], source }`, where `source` is `apx`
(consultants' own phrasing), `site-docs` (phrases from the site's own pages),
or `author` (written by the session). Author-written queries are reported
separately and never pooled with the others: the July dogfood taught that an
author-written test is inadmissible as evidence.

Per query: the engine's substring stage produces up to 30 candidates; one
request asks a Noul per candidate and one Noul on whether anything answers.

- Metric: top-1 and top-5 hit rate of the rerank (candidates at or above 0.5,
  sorted) against the substring top-5, on queries with an intended subject;
  the share of no-answer queries the `any` Noul puts below 0.35.
- Win: rerank top-1 exceeds substring top-1 by at least 15 points on the
  non-author queries, with honest-empty at or above 0.8.
- This arm does not run until at least 20 non-author queries exist.

### Arm 5: the cited evidence supports the claim (added 2026-09-20)

Registered after arms 1 to 4 reported, before any arm 5 call. It is the arm
the first study named and did not run.

**The claim under test.** An agent proposes an operation and cites something
as its evidence. A reviewer wants to know whether the citation holds. This
arm asks exactly that question over citations a person actually wrote.

**Items.** The self-model's evidence document carries 358 authored
observations of the form `(subject, repo:<path>)`: this subject is evidenced
by this file, each one confirmed by `reconcile`. Each item hands the model the
subject's name, kind and description, the cited path, and the cited file's
contents, and asks whether that file is where that subject lives.

- **Supported (positive):** the observation as authored.
- **Fabricated (hard negative):** the same subject with a *sibling* file from
  the same directory, admitted only where no observation anywhere cites that
  file for that subject. A sibling, not a random file, because the failure
  worth catching is an agent citing the nearly-right thing.

Sampling is balanced, seeded, and frozen to `datasets/evidence-citations.self.json`
before the first call.

**Metric.** Balanced accuracy over the two classes, and separately the share
of fabricated citations the model calls unsupported. A Score with three levels
(supported / cannot tell / not supported); "cannot tell" is never counted as a
catch and never as a false alarm, and its rate is reported.

**Win.** Balanced accuracy at or above 0.85, with fabricated-citation recall
at or above 0.80.

**The ablation, and why this arm has one.** Arm 1 scored 0.872 on the
self-model and 0.534 on an adopter's, because what looked like skill was house
style. This arm cannot be run on a second record: neither frozen dataset
carries an evidence document, which was checked before registering rather than
discovered after. So the transfer question is attacked from inside one record
instead.

Every item runs twice: once with the cited file's head included (**5a**), once
with the path alone and no content (**5b**). The registered prediction is that
5a clears the win and 5b does not.

- If **5b** scores close to **5a**, the model is reading our naming
  conventions, not the cited material, and this arm has measured house style
  exactly as arm 1 did. That is a negative result and is reported as one,
  whatever 5a says.
- If **5a** clears the win and **5b** falls at least 15 points below it, the
  material is doing the work. That is the mechanism this arm exists to test,
  and it is the condition under which the result has any claim to transfer.

**What this arm cannot show.** It cannot show the judgment works on a record
this project did not write. A win here is evidence that the mechanism is
reading rather than pattern-matching, and a reason to run it on an adopter's
record with an evidence document. It is not a result on that record, and must
not be reported as one.

### Stability, every arm

Each arm's requests are repeated three times. Reported: the per-question
standard deviation across the three runs, mean and 95th percentile, and how
many Choice winners and Score levels flip. No win threshold; this number sets
the width of the uncertain band any product gate would need.

## Who judges what

- Jev supplies every judgment under measurement.
- Labels and disagreement reviews are the maintainer's (Nabeel), given before
  seeing the model's answer where the protocol says so.
- The session orchestrating the runs (Opus for this study) may draft
  labels for the maintainer to confirm, in a separate column, and may not
  grade anything that has a label.

## Decision after the study

- Arm 1 and arm 2 both win: propose the analysis pass for hosted workspaces
  on yarramate.dev behind the site's notice and per-workspace switch, and the
  small upstream exposures (near-duplicate candidates at a caller's floor, a
  cited-material field on an operation, the ask candidate list with scores).
- One of them wins: propose that one alone.
- Neither wins: record the negative result here and close the question; the
  exception lapses unused.

In every case the engine's README sentence stays as it is.

## Amendments

- 2026-09-20, before any call: the self-model's near-duplicate candidates are
  dominated by artifact subjects named after file paths (test files, schemas),
  which are trivially different and would inflate precision for the judgment
  and the shipped rule alike. Arm 2 therefore reports its metrics twice: over
  all labelled pairs, and over pairs where at least one subject is not
  path-named. The win condition applies to the second.
- 2026-09-20, before any call, arm 4 on Halcyon: the website session supplied
  29 queries (24 with an intended subject, 5 intended empty), validated against
  the showcase. Their source is registered as `site-session`: one non-author's
  guesses at visitor phrasing, drawn from the site's deck and docs copy, not
  observed visitor queries. Their wording deliberately avoids the record's own
  names, which is the condition under test; the baseline is the shipped
  substring stage as it is, and the write-up must say the baseline is lexical.
  One query is excluded (`skip`): "show me everything that is only planned" is
  a status filter the roster mode answers exactly, not a rerank question. Two
  are kept with a note: a relationship question and a question for a number,
  whose intended subjects are still the seeds a slice would start from. A
  second batch of in-vocabulary but unmodelled empties ("smart meter rollout
  schedule") is requested and will be scored as its own line.
- 2026-09-20, before any call, shortlist rule: two of the 29 queries have no
  substring hit at all, so a rerank of substring hits alone could not find
  them. The shortlist is therefore substring hits first, then the remaining
  subjects in id order up to the shortlist size of 30. On a workspace of 30
  subjects or fewer this is every subject; on a larger one the padding is
  arbitrary and the count of zero-hit queries is reported so that limit is
  visible. Intended ids may be written qualified or local; the harness accepts
  both and refuses an unknown id.
- 2026-09-20, before any call, arm 4 second batch: four present-vocabulary
  empties from the website session, each naming a real subject and asking for
  a property the record does not carry (running cost, service level,
  retention, territory). A fifth, "who supplies the new meters", is dropped on
  the author's own advice because a marker could accept the replacement
  programme as its answer. Empties are scored on two lines, absent-vocabulary
  and present-vocabulary, and for the second the rerank's top answer is
  classed as "the named subject" or "something else", beside the same for the
  substring baseline. Returning the named subject with more confidence is the
  baseline's error, not an improvement.
- 2026-09-20, written after the Halcyon kind-fit run (n=14) and BEFORE any
  self-model answer was seen, arm 1b: on Halcyon the model read each option as
  plain English and picked the plainly-true phrase over the ArchiMate one. A
  technology node "serves" an application in ordinary speech; ArchiMate says
  realization. A requirement "influences" a goal in ordinary speech; ArchiMate
  says realization. Four of the eight disagreements are that one substitution.
  Arm 1b therefore repeats the same Choice over the same edges with ArchiMate's
  meaning of each kind beside its reading (`KIND_DEFINITIONS` in arms.mjs).
  Both arms are reported. Arm 1 remains the registered primary; 1b is an
  exploratory variant and is labelled as such wherever it appears, because it
  was written after seeing one dataset's answers.

- 2026-09-20, before any arm 5 call: the registered material was "the head of
  the cited file", set at 40 lines. Looking at the frozen items before spending
  showed the flaw: a third of them are TypeScript files whose first forty lines
  are nothing but imports, and a sixty-line window of a two-thousand-line file
  shows whichever part of it the window happens to land on. Either way the
  material could not answer the question, so the arm would have measured
  something other than what it claims to.

  The material is now the cited file's **whole contents**, capped at 40,000
  characters. 107 of the 118 items fit under that cap entire; the 11 that do not
  are flagged `truncated` in the frozen set and their results are reported
  separately. This widens what arm 5a is given and leaves 5b, the ablation,
  exactly as registered: path only, no contents. It therefore makes the
  registered prediction harder to fail by accident and easier to fail honestly,
  since 5a now has no excuse for missing an answer that is in front of it.

  Frozen set: `datasets/evidence-citations.self.json`, seed 20260920,
  60 supported and 58 fabricated over 60 subjects.

