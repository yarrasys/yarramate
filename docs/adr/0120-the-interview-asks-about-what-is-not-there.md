# The interview asks about what is not there

Status: accepted

Running the full loop on GitLab FOSS v19.3.0 drove the interview from 55
open items to 3, and every gate agreed the model was done: check green,
reconcile 39 of 39 confirmed, no subject without evidence. It was not
done. The strategy layer was empty while GitLab's stages are a textbook
capability map, `config/feature_flags/` held 559 definitions nothing
asked about, `app/events/` held 62 domain events with `applicationEvent`
never appearing, and Zoekt and the Elasticsearch indexer sat
version-pinned mid-migration with no succession recorded.

The misses share one mechanism. Every question in the shipped catalogue
that fired anchored on a declared subject: "this component realizes
nothing", "this service has no motivation". A question about a kind with
zero subjects has nothing to attach to, so it never fires, so **a whole
absent layer is indistinguishable from a covered one**. The self-model
showed the same failure on 2026-08-06 with six shipped features and no
declared subjects, all gates green. Two models, one process, so it is a
property of enrichment rather than of either model.

`no-subject-of-kind` and `scope: workspace` were already in the engine
(the catalogue barely spent them), and the audit on #272 added the
second half of the finding: 39 confirmations in a row is not evidence of
agreement, it is evidence that nothing was put at risk. Praefect is
declared on GitLab's own architecture page and absent from the FOSS
tree, a non-confirmation lying in the open that nothing asked for.

## Decision

Catalogue `core-enrichment` goes 1.1 to 1.2, additively, and the engine
gains one condition.

- **Five layer-presence questions, anchored on the workspace.**
  `no-capability-declared`, `no-event-declared`, `no-artifact-declared`
  and `implementation-path-missing` fire on `no-subject-of-kind` at
  `scope: workspace`, so the question exists whether or not the layer
  does. `no-contract-declared` is the one with a precondition: it pairs
  `no-subject-of-kind` with `exists-linkage`, because a model where
  nothing serves, flows to, or triggers anything else has no exchange to
  govern and asking it for contracts would be noise.
- **An unanswered presence question is information.** Each resolution
  says what a genuine "none" means rather than pretending the question
  goes away: an architecture truly at rest keeps
  `implementation-path-missing` open, and that open question is the
  model saying nothing is changing. This is the property that makes
  absence legible; a question that could be dismissed silently would
  restore the failure it exists to end.
- **`unchallenged-evidence`, the one condition that reads the evidence
  overlay.** It holds where the overlay records observations and every
  one is a frictionless confirmation: no contradicted, unknown or
  not-observed result, and no recorded search. `evidence-unchallenged`
  spends it once, at workspace scope, in the hygiene wave.
- **A recorded search closes it even on a confirmed result.** ADR 0107
  made an absence auditable by recording the searches that came back
  empty. A confirmation resting on such a search has tested a claim it
  might fail, because the search could have come back non-empty, so it
  counts as a challenge exactly as an honest non-confirmation does. The
  question asks whether the inspection risked anything, not whether it
  found fault.
- **Absent and empty overlays both stay quiet.** No observations means
  no inspection to interrogate. An overlay the caller never supplied
  means the diversity is unknown rather than absent, the rule
  `unconstrained-kind` already applies to a missing profile context. The
  CLI paths (`ask`, `ask --open`, `ask --advise`, `design`) now load the
  workspace's declared evidence and pass it in, so the condition is live
  wherever a workspace declares an overlay.
- **The visual hosts stay evidence-blind, and therefore quiet.** Neither
  the session server nor the mounted host reads evidence today: the
  mounted host's store carries documents and profiles, which is what
  `applyOperations` compiles from (ADR 0100). A nudge that appeared in
  one host and not the other would be worse than one that appears in
  neither, so both pass no overlay and the canvas overlay omits this
  question. Recorded as follow-up rather than built.
- **The evidence loader stops dropping provenance.** `loadEvidence`
  rebuilds every observation field by field, and until now the rebuild
  dropped `searched` and `measured`. Through the real load path that
  made `reconcile` count every `not-observed` as an unsupported absence
  however carefully its author recorded the search, and it would have
  made this new condition read every overlay as probe-free. Both fields
  now survive normalization.
- **Citation is asked of capabilities.** `capability-uncited` fires on
  `missing-reference` for a capability with no `refers-to`. A capability
  is the layer with no code to point at, so the record that specifies it
  is the only thing an audit can grade the claim against.
- **`states-undefined` learns that evidence can answer it.** It gains an
  `askPlain` phrasing and says plainly that a repository carrying its
  own migration plan or target design in-tree has already declared that
  change shape matters. The question was `authority: human` and stayed
  that way; what changed is that it now points at the record instead of
  waiting for someone to remember it.
- **Versioning.** Every new question carries `since: "1.2"`, so a model
  that legitimately reopens does so under ADR 0063's honest-reopen
  discipline. `INTERROGATION_SEMANTICS_VERSION` stays at 1: no existing
  question's answer moves for an unchanged model, which is exactly the
  promise that version makes.

## Excluded options

- **A succession question of its own** (candidate 4 on the issue). The
  detection already exists: `near-duplicate` computes the overlapping
  pairs and `subjects-near-duplicate` asks about them, so a new question
  would fire on the same pairs and ask the same thing twice. The real
  gap is narrower, that succession is not one of the answers that closes
  it, and only `distinctFrom` dismisses a pair (ADR 0077). Teaching
  `supersedes` to dismiss would change an existing question's answer for
  an unchanged model and cost an `INTERROGATION_SEMANTICS_VERSION` bump,
  which an additive catalogue release does not spend. What ships instead
  is wording: the resolution now names succession as the third honest
  answer, says to scope it where the takeover is partial (ADR 0109), and
  says to record `distinctFrom` alongside it, because succession states
  what the pair is to each other while distinctness is what the question
  asks. Whether a recorded succession should dismiss the pair outright
  is left as its own decision.
- **A citation question across every kind.** `missing-reference` over
  all subjects would open a line per subject on a model of any size and
  turn the hygiene wave into a wall, which is how a catalogue teaches
  people to skim it. Capability is where the citation carries the most
  and the count stays small.
- **A ratio threshold on evidence diversity** ("fewer than N per cent
  non-confirmed"). No one can defend the number, and the honest line
  needs no number: either the inspection risked something once or it
  never did.
- **Firing on a workspace with no evidence at all.** That is a different
  question, about whether anything was inspected rather than about what
  the inspection dared, and it belongs to the artifact-side coverage gap
  #175 owns. Reading absence as failure here would also make the
  condition fire on every model that has not started evidence work,
  which is most of them.
- **A presence question per concept kind.** Sixty-two kinds would give
  sixty-two workspace questions and no interview survives that. The five
  shipped are the layers whose absence changed a real answer on GitLab,
  and the catalogue is data: an organisation that wants a sixth writes
  it.

## Consequences

The shipped catalogue goes from 44 questions to 51. Models that pass
today will legitimately reopen, which is the point, and `since: "1.2"`
tells a reader which reopenings are new questions rather than
regressions. The self-model reopened on four of them and was answered
through: a published-formats contract, the `changeset.commit`
application event, `refers-to` references on the seven capabilities, and
one observation that holds a negative claim up to failure by recording
the searches that would contradict it. It is back to 0 open of 51.

The trigger union in the three published schemas gains a branch. A
consumer validating a 1.2 report against a pinned pre-1.2 schema copy
will reject a trigger it has never seen, the same compatibility shape
the required `trigger` field carried in 1.2.0. A consumer of the pure
engine that passes no overlay gets exactly the report it got before.
