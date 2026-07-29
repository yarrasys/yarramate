# Context benchmark (research design)

Status: design draft for review — no benchmark code exists yet. This
document defines the protocol so implementation is mechanical and the
claims the benchmark can and cannot support are fixed before any numbers
exist.

## Hypotheses

**H1 — context value.** An agent given YarraMate context (status,
projections, ad-hoc slices) completes repository tasks more successfully
and/or more cheaply than the same agent given only the repository and its
prose documentation.

**H2 — capability flattening.** The deterministic loop (check → evidence →
reconcile → gap catalogue) narrows the quality gap between weaker and
stronger models for *model-building* tasks: validity, groundedness, and
coverage converge across tiers, while abstraction quality remains
tier-separated. This is the weak-generator/strong-verifier bet stated
falsifiably.

**H3 — trust sensitivity.** A deliberately stale model (contradicted
claims left in place) performs *worse* than no model at all. If H3 holds,
the drift signal is load-bearing, not hygiene theatre.

## Protocol

### Task suite

- N ≥ 5 repositories with committed, checked `.yarramate/` models
  (the showcase gallery provides these; the YarraMate repository itself is
  excluded from headline numbers as self-serving, reported separately).
- M ≥ 6 tasks per repository across three families:
  1. **Comprehension** — "which component owns X?", "what breaks if Y is
     retired?" — scored against the model as ground truth after human
     verification;
  2. **Change** — implement a bounded feature or fix touching ≥ 2 declared
     components — scored by tests passing plus rubric review;
  3. **Model maintenance** — extend the model for a described change —
     scored by check pass, reconciliation results, and catalogue coverage.
- Tasks are authored before any condition is run and frozen.

### Conditions

| Condition | Repository access | Architecture context |
| --- | --- | --- |
| A (baseline) | full | none — prose docs only |
| B (yarramate) | full | status + projections + ad-hoc context |
| C (stale) | full | model with ≥ 3 contradicted claims injected |

Same agent harness, same prompts apart from the context instruction, fixed
model per run. For H2, repeat A and B across ≥ 2 capability tiers.

### Metrics

- Task success (primary; binary per task, human-adjudicated rubric for
  change tasks);
- Tokens and tool calls to completion (cost);
- Wrong-file/wrong-component edit rate (a proxy for misorientation);
- For model-maintenance tasks: check verdict, contradicted count, open
  catalogue questions before/after.

### Reporting

Publish per-repository and pooled deltas with confidence intervals, the
full task suite, transcripts, and the exact model/harness versions. Report
negative results with the same prominence — if B does not beat A, that is
the roadmap speaking.

## Threats to validity

- **Self-fulfilling ground truth.** Comprehension answers scored against
  the model must be independently human-verified against the code, or the
  benchmark measures model-parroting, not understanding.
- **Model quality confound.** B's advantage depends on model quality;
  gallery models must pass check, reconcile clean, and close the core
  catalogue before freezing.
- **Prompt leakage.** Condition instructions must not hint that one
  context source is preferred; phrasing review before freezing.
- **Small N.** Early runs will be underpowered; report intervals, never
  bare point estimates.

## Implementation sketch

A runner needs: task manifest (YAML), per-condition harness invocation
(headless agent CLI), transcript capture, deterministic scoring hooks for
check/reconcile/catalogue metrics, and a human adjudication queue for the
rubric items. Estimated order: gallery models (blocked on showcase task) →
task authoring → runner → tier sweep.

## Relationship to the roadmap

The benchmark is the keystone adoption artifact: if the deltas are real
they convince harness vendors; if they are not, they redirect product
priority with evidence. Either outcome pays for the work.
