# Reviewing model and profile growth

Three deterministic gates run against a YarraMate model, and none of them asks
whether a distinction earns its place. `check` decides correctness.
`reconcile` reports drift between declared intent and observed evidence.
`ask --open` reports which catalogue questions are still unanswered. A model
can accumulate concepts nobody needs and pass all three.

What remains is review at the Git boundary, where a person reads a diff and
decides. This document is written for that reader. It is a set of questions to
put to an author, not a rule set for an author to satisfy in advance.

## Why growth needs a brake

The spec-build benchmark measured the problem. Three designer runs were given
the same specification and declared 47, 44, and 27 planned concepts
(`research/context-benchmark/spec-build/RESULTS-2026-07-31.md`). Nothing in
the prompt or the question catalogue constrained granularity, and the results
record the consequence plainly: the model does not currently make two
designers converge on how finely to model. Every one of those models passed
its checks. Correctness was never the variable.

That is the best available demonstration that unconstrained modelling varies
widely, and the variance is in judgment rather than in tooling.

Prior art names the discipline. Gruber's ontology design criteria are clarity,
coherence, extendibility, minimal encoding bias, and minimal ontological
commitment. The last is the relevant brake: commit to as little as possible
while still supporting the intended sharing. Make the smallest set of claims
that lets the parties using the model do their work, and leave the rest free
for them to decide. Applied here, it argues against modelling everything that
can be modelled and for modelling what changes a decision.

## What this document is not

It is not mechanizable, and no part of it should become a gate.

A concept count is not a quality signal. The 27-concept benchmark model is not
better than the 47-concept one because it is smaller, and nobody has
established which of the three was right. Any threshold on size would be
satisfied by collapsing two honest subjects into one dishonest one, which
makes the model worse while making the number better. These questions need a
reader who understands the domain, which is why this is a document and not a
diagnostic.

Failing one of these questions is not a defect. `check` decides defects. These
questions decide whether a reviewer should ask for the rationale before a
distinction becomes vocabulary that every later reader inherits.

## Admission tests for a subject

### 1. What decision does this distinction change?

The question catalogue already holds itself to this bar. Every catalogue
question carries a materiality statement, defined as the decision its answer
changes, and those statements are concrete about consequence:

> The hosting boundary decides latency, failure domain, scaling model, and
> data residency; a component with no declared runtime is deployed by whoever
> gets there first.

Ask the author for a materiality statement of that shape for the new subject.
Someone acts differently once the distinction exists, and a real answer names
who and how. An answer that describes what the subject is, rather than what it
decides, has not answered the question.

Where a real answer exists it belongs in the model, as the subject's
`description`, which compiles into a claim that evidence can later confirm or
contradict. A rationale that lives only in a pull-request comment is not
reviewable a year later.

### 2. Would two authors classify the same instance the same way?

Take an instance that sits near the new boundary, ask the author where it
goes, then ask what rule put it there.

If the rule needs the author present to adjudicate, the model carries a
private convention rather than shared vocabulary, and the next author will
draw the boundary somewhere else. This is Gruber's clarity and coherence
criteria in review form: a definition should be independent of the
conversation that produced it, and a reader who was not in that conversation
should reach the same answer.

The benchmark's granularity spread is what this failure looks like at scale.
Three competent designers, one specification, no shared rule for how finely to
cut.

### 3. Can you point at an instance today?

A subject introduced for a case that has not arrived commits every later
reader to a distinction no instance has tested.

The asymmetry favours waiting. Adding later is cheap, because `apply` lands
additions as one atomic validated batch. Removing later is not, because by
then the distinction has been cited by relationships, projections, evidence,
and adapter mappings, and every referring input has to be found and updated
before the identity can change.

Anticipatory structure is not always wrong. A declared target state is
deliberately about what does not exist yet, and `presentIn: [target]` is the
honest way to say so. The question is whether the author can name the instance
or the planning state. Neither answer is the problem.

### 4. Is the distinction already carried by a field?

Native documents carry `status`, `owner`, `constraints`, `references`,
`description`, `mode` on access, and `content` on flow. A distinction that one
of those already expresses does not need a new subject or a new kind.

ADR 0073 is this test applied and recorded. A `declined` lifecycle value was
proposed for non-goals and rejected, because it was contract surface across
the schema, the projection vocabulary, the evaluator, and every adapter,
bought only to distinguish "retired at birth" from "retired later", a
distinction the description already carries in prose. The convention was kept
and the vocabulary was not widened.

## Additional tests for a profile kind

A profile kind is heavier than a subject. It enters the vocabulary that every
document under that profile may use, it is inherited by profiles extending
that one, and its globally qualified identity appears in the compiled graph,
so it reaches every consumer of the interchange. A subject is one claim among
many. A kind is contract.

### 5. What breaks if authors use the core parent instead?

Every new kind declares a globally qualified semantic parent, inherits its
aspect, inherits its endpoint constraints, and may only narrow them, never
broaden them. So the question has a small number of good answers, and a
reviewer should expect one of them:

- the kind narrows an endpoint constraint through `sourceAspects` or
  `targetAspects`, and the narrowing is one the author wants the compiler to
  enforce on every future document;
- a projection selects on the kind, and selecting the parent with
  `kindMatching: descendants` would select too much;
- an adapter renders it differently, through a kind mapping.

"The name reads better" is not one of them. `name` and `description` on the
concept already carry the label, they compile into claims, and they cost no
contract surface.

This repository's own profile is a fair standard to hold authors to.
`.yarramate/profiles/yarramate-development.yaml` declares three kinds, two
concept kinds and one relationship kind, for a self-model of roughly 470
authored subjects.

### 6. Do the inherited questions still make sense?

Catalogue subject selectors match profile-derived kinds through their parents
by default, so a new kind silently inherits every question written against its
parent. That is usually right and occasionally not.

Ask whether the inherited questions read sensibly for the new kind. The
catalogue records one place where the answer was no: `component-unhosted`
matches with `kindMatching: exact` by intent, because profile-derived module
kinds inherit their deployable parent's hosting rather than answering
separately. A kind whose inherited questions are mostly nonsense is evidence
that the declared parent is wrong, not that the questions are.

## An additional test for a catalogue question

### 7. Does its trigger tell a UI what would answer it?

Every question's trigger rides its report verbatim
([ADR 0110](adr/0110-an-open-question-carries-its-answer-shape.md)), so a
consumer builds its answering affordance from the condition rather than from
prose. How much affordance it can build depends entirely on which condition
was chosen, and two conditions that fire on the same subjects are not
therefore equal.

`missing-linkage` and `has-linkage` name their `counterpartKinds`, so a host
can offer exactly the endpoints that would answer the question instead of
everything the relationship table tolerates. `missing-relationship`,
`no-subject-of-kind` and `missing-constraint` name their `kinds`.
`missing-claim` names its predicate. Against those, `isolated`,
`near-duplicate` and `missing-flow-content` say only *that* something is
absent, and a consumer holding one has nothing to build with: the question
degrades to prose, and a reviewer answers it by leaving the pane.

The first external catalogue author reports exactly this, having written
fourteen questions: ten use conditions that carry enough for their endpoint
picker, and the ones that do not "degrade to prose and it shows."

So when a question could be expressed by more than one condition, prefer the
one that names what would answer it. This is not a rule that a vaguer
condition is wrong — `isolated` says something no narrower condition can —
but a question phrased against a condition that carries kinds is worth more
to every consumer than the same question phrased against one that does not,
and the choice is usually free at authoring time.

## Using this in review

Ask the questions in the pull request. Record the answers where they will be
read again: `description` on the subject for rationale about that subject, an
identified `references` entry when the rationale depends on another subject,
and an ADR when the decision governs future modelling rather than this model.

An author may reasonably run the same questions against their own proposal
before opening the pull request. That does not change what the document is.
The questions are worth asking because someone independent asks them, and a
self-review that answers all seven is a well-prepared proposal, not an approved
one.

Approve growth that carries its rationale. The deliverable of this review is
not a smaller model. It is a model whose distinctions someone can still defend
on a day when the author is unavailable.

## Boundaries

- These questions govern additions to declared intent. Evidence is not
  governed by them: an observation records what was seen and commits the model
  to nothing.
- Nothing here overrides `check`. A model that fails these questions and
  passes `check` is correct, and possibly overgrown. A model that passes these
  questions and fails `check` is broken.
- There is no score, no threshold, and no command. A future proposal to
  mechanize any part of this should carry evidence that the measurement means
  something, which the benchmark does not currently provide.
