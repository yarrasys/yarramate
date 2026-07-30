# Design and handoff family (research design)

Status: **draft for review. No tasks authored, no runner support, no numbers.**
Protocol is written first on purpose, as with the v1 design: the hypotheses
below are meant to be frozen before any run exists.

## Why the existing suite cannot answer the question

The v1 sweep (164 runs, [RESULTS-2026-07-29.md](RESULTS-2026-07-29.md))
reported H1 as directionally positive but not significant, with comprehension
saturated at both tiers. Read alongside the task inventory, that outcome was
close to structural rather than surprising:

- 79 tasks across v1 and v2 are **39 comprehension, 22 change, 18
  model-maintenance, and 0 design**;
- every condition hands the agent a *complete, mature* repository, so for
  comprehension the model is largely **redundant with the source** — an agent
  can read miniflux, and a model can at best match what reading yields;
- the subject repositories are well-known open source, so the model also
  competes against whatever the agent already memorised (recorded as
  prior-knowledge contamination in the v1 threats).

Architecture context is worth most where substitutes are absent. The v1 design
measures the case where substitutes are abundant. The same reasoning applies to
H3: a falsified model mostly failed to mislead because the code was present to
contradict it.

This family targets the case where the substitute genuinely does not exist:
**work that is designed but not yet built.**

## What must not be scored

Design quality has no ground truth, and YarraMate deliberately checks
deterministic correctness rather than architectural taste. Nothing here scores
whether an architecture is *good*. Everything scored is either mechanically
decidable or human-adjudicated under the v1 policy — agent-drafted verdicts
remain advisory and never final.

## Hypotheses

**H4 — structured intent beats prose intent.** Given the *same* declared
intent, an agent that receives it as a checked YarraMate model conforms to it
more closely than an agent that receives it as prose. This is deliberately not
"model versus nothing"; see the tautology trap below.

**H5 — shared intent reduces divergence.** Across repeated independent runs of
one task, the structures produced under a checked model agree with each other
more than those produced from prose. If H5 holds, the product claim is
consistency across agents and sessions, which is the team-scale claim.

**H6 — falsified intent is most harmful where code cannot contradict it.**
A model with injected contradictions performs *worse than prose* on the unbuilt
portion. H6 is the H3 retest in the setting where H3 is actually falsifiable:
in v1 the completed code contradicted the lie, so the lie was cheap.

## Protocol

### Fixture: replay a real feature at its midpoint

Authoring greenfield fixtures would make our own taste the answer key. Instead,
take a feature that a subject repository genuinely shipped across several
commits, and reconstruct the handoff:

1. pick the feature and its merge commit `F` upstream;
2. `H` = a commit partway through the feature's own series — code exists for
   part of it, the remainder is unbuilt;
3. the workdir is the repository at `H`;
4. the **answer key is upstream's own completed feature at `F`** — not a
   design we invented.

This keeps ground truth external to us, and gives every task a natural
handoff seam: the part upstream had not written yet at `H`.

### The reference model is the ruler, not the treatment

Author one reference model per task describing the *completed* feature as
declared intent. It is **not given to any condition**. It exists to be
compiled into the scoring instrument: a set of structural assertions derived
from the model and from `F` — modules that must exist, symbols that must be
exported, edges that must hold (module A imports B; handler X dispatches to Y).

Because the assertions are structural, the same instrument scores A, B and C
alike, including the arm that never saw a model. That is what makes intent
conformance a number rather than an opinion.

### Conditions

| Condition | Repository access | Declared intent for the unbuilt part |
| --- | --- | --- |
| A (prose) | repo at `H` | the same intent, as a prose design brief |
| B (yarramate) | repo at `H` | the same intent, as a checked model + CLI |
| C (stale) | repo at `H` | model with ≥ 3 contradicted claims injected |

As in v1, B and C receive one verbatim instruction so staleness is not
detectable from the prompt, workdirs carry no subject-repository agent
configuration, and the model is fixed per run. For H4/H6 repeat across ≥ 2
capability tiers; for H5 repeat each cell k ≥ 3 times.

⚠️ **The tautology trap, and the rule that defuses it.** If A were given no
intent at all, B would win by construction and the result would be worth
nothing. A therefore carries the *same information*, in the form teams
actually use today: a design document. The claim under test is narrower and
far more useful — **a checked structured artifact beats a prose brief** — and
it is losable.

That makes the prose brief the integrity crux of the whole family. It must be
a steelman, not a strawman. Protocol rule: the brief is generated **from the
reference model** by an agent that does not run the sweep, then reviewed for
information parity against the model — every subject, relationship and
constraint present in the model must be recoverable from the prose. A reader
who suspects the prose arm was weakened can check it, because both artifacts
ship with the results.

### Metrics

Mechanical, computed identically for every condition:

- **Intent conformance** — fraction of the reference structural assertions
  satisfied by the produced tree. Primary.
- **Interface agreement** — of the names and boundaries the reference declares
  (module paths, exported symbol names, seam signatures), the fraction the run
  matched. This is the sharpest expected discriminator: in A the agent must
  *invent* names for the unbuilt half; in B they are declared. Disagreement
  here is exactly what breaks a real handoff.
- **Divergence** — pairwise Jaccard distance over satisfied-assertion sets
  across the k runs of a cell (H5). Reported per cell, not per run.
- **Rework to green** — turns, tokens, cost, and whether the subject
  repository's own tests pass. A change that leaves tests broken fails, as in
  the v1 adjudication policy.
- **Model upkeep** (B and C only) — after the work, does `check` still pass,
  does `reconcile` report zero contradicted, and is catalogue density not
  worse. These are the existing model-maintenance gates.

Deliberately absent: any score for elegance, layering, or naming quality
beyond agreement with the reference.

### Suite representation

The family needs schema work, so it lands as a new suite version rather than an
edit to a frozen file:

- `type: yarramate/benchmark-suite/v3`, with `family` gaining
  `design-handoff`; `v1` and `v2` stay valid and unchanged.
- New per-task fields for this family: the handoff commit `H`, the reference
  commit `F`, the reference model path, the compiled assertion set, and the
  prose brief path.
- `headline` continues to mark which suites pool into published figures.

## Threats to validity

- **Prior-knowledge contamination is worse here, not better.** The agent may
  have memorised upstream's actual implementation of the very feature it is
  asked to build. Mitigations: prefer features merged after the model's
  training cutoff; prefer the least famous subject available; report per-task
  suspicion rather than pooling silently. If a task shows near-perfect
  interface agreement in *A*, treat it as contaminated rather than as evidence
  against H4.
- **Prose-arm calibration decides the result.** Covered by the parity rule
  above; it remains the single easiest way to rig this family, so both
  artifacts must be published.
- **Assertion authoring is a taste channel.** Whoever compiles the assertions
  chooses what counts as conformance. Derive them from `F` mechanically where
  possible, and have a second author review them against the diff before
  freezing.
- **Handoff realism.** A midpoint commit is not the same as a real human
  handoff with meetings and tacit context. This measures the artifact, not the
  social process.
- **Small N.** Unchanged from v1: report intervals, never bare point
  estimates.
- **n = 1 anecdote is not evidence.** The yarradev-ai design journey motivated
  this family but cannot support it: one project, authored by the tool's own
  author, measuring author fluency as much as tool quality. That session also
  recorded the loop going quiet after `check` first passed, with implementation
  planning moving to an external checklist — which is why `next` exists, and
  why `next`'s value is itself unvalidated and in scope here.

## Relationship to the roadmap

If H4 and H5 hold, the pitch becomes provable where it is currently only
plausible: declared intent as a checked artifact that keeps independent agents
and sessions building the same system. If they fail, the honest read is that
YarraMate's demonstrable value is the deterministic half — validity, drift
detection, and CI gating — and the positioning should say so and stop implying
better agent output.

Either outcome pays for the work, on the same terms as the v1 design.
