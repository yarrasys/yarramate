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
- Tasks are authored before any condition is run and frozen. Errata found
  after a sweep are corrected as a new suite version (`type:
  yarramate/benchmark-suite/vN`) beside the old file, never as an edit to a
  version that has been run: published numbers stay pinned to the text that
  produced them. Suites at different versions are not pooled.

### Conditions

| Condition | Repository access | Architecture context |
| --- | --- | --- |
| A (baseline) | full | none — prose docs only |
| B (yarramate) | full | status + projections + ad-hoc context |
| C (stale) | full | model with ≥ 3 contradicted claims injected |

Same agent harness, same prompts apart from the context instruction, fixed
model per run. For H2, repeat A and B across ≥ 2 capability tiers.

Prepared workdirs carry no agent configuration except the harness's own. The
subject repository's `CLAUDE.md`, `AGENTS.md`, `.claude/` and `.mcp.json` are
moved out of the workdir before the run and the run record lists what was
moved; only then do model-bearing conditions receive YarraMate's pointer
(ADR 0045) under those names. Keeping the subject's configuration is available
as an explicit realism choice and is recorded as such.

### Metrics

- Task success (primary; binary per task, human-adjudicated rubric for
  change tasks);
- Tokens and tool calls to completion (cost);
- Wrong-file/wrong-component edit rate (a proxy for misorientation);
- For model-maintenance tasks: check verdict, contradicted count, open
  catalogue questions before/after.

What an agent changed is captured by staging the whole working tree and
diffing it against the run's pinned baseline commit, so a file the agent
created and a change the agent committed both appear — in the changed-file
list and in the saved patch. A working-tree-only diff against `HEAD` sees
neither, and both are ordinary agent behaviour.

Open catalogue questions are counted once per matching subject, so declaring a
concept mechanically opens more of them and at least one (`owner-missing`,
human authority) cannot be answered for a third-party repository at all. Tasks
that add concepts are therefore gated on open questions *per concept*, not on
the absolute count; tasks that only remove or restructure keep the absolute
comparison.

Change and model-maintenance runs that finish in fewer than three turns are
flagged for review rather than scored on their exit code: a clean exit that
did no work is invisible to the harness-failure counter and reaches the
adjudicator looking like an ordinary attempt.

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
- **Subject-repository agent configuration.** Coding harnesses auto-load
  instruction files the subject repository ships, and tiers obey them
  unequally — uptime-kuma's upstream anti-AI `CLAUDE.md` cost the weak tier
  four one-turn refusals in the 2026-07-29 sweep and the strong tier none.
  Left in place it measures instruction-following, not context value.
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

## Successor design

This design covers work on complete repositories, where the source is present
and the model is partly redundant with it — the setting in which the
2026-07-29 sweep found comprehension saturated. A proposed successor family
for designed-but-unbuilt work, where no substitute for declared intent exists,
is drafted separately in
[DESIGN-HANDOFF-FAMILY.md](DESIGN-HANDOFF-FAMILY.md). It is a draft: no tasks,
no runner support, no results.
