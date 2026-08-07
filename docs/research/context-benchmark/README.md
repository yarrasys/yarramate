# Context benchmark (research implementation)

Status: research artifact — nothing here is wired into the compiler, CLI, or
package exports. The protocol is frozen in [DESIGN.md](DESIGN.md); this
directory adds the task suites and the runner that make it executable.

```text
context-benchmark/
  DESIGN.md                              # frozen protocol: hypotheses, conditions, metrics
  DESIGN-HANDOFF-FAMILY.md               # settled design: building from a published spec (H4-H6)
  ELICITATION-PILOT-2026-07-31.md        # pilot: freehand vs interrogate across 3 tiers (8 runs)
  spec-build/                            # H4-H6 executable family: frozen delta + prompts + runner
  yarramate-benchmark-suite.schema.json  # draft schema for yarramate/benchmark-suite v1-v2
  tasks/                                 # frozen task suites, one per repository
    v2/                                  # errata-corrected suites (see "Suite versions")
  runner/
    validate-suite.mjs                   # schema + cross-checks (ids, family minimums, prompt leakage)
    conditions.mjs                       # condition A/B/C instructions (B and C verbatim-identical)
    agent-config.mjs                     # subject-repo agent-config quarantine + pointer placement
    agent-config.test.mjs                # self-test for agent-config.mjs, ordering included
    degenerate.mjs                       # <3-turn change/maintenance runs, flagged for review
    inject-stale.mjs                     # condition C: deterministic contradicted-claim injection
    run-benchmark.mjs                    # tasks x conditions matrix, workdir isolation, transcripts
    score.mjs                            # deterministic metrics + human adjudication queue
```

## Freeze policy

Task suites are frozen at merge, before any condition is run (DESIGN.md,
"Task suite"). Editing a merged suite invalidates comparisons; add a new suite
file instead. Ground-truth answers cite the code locations they were verified
against — the source repository at the pinned commit is the authority, never
the model.

## Suite versions

The `type:` field is the suite version, and a suite is frozen per version.

- **v1** — `tasks/*.yaml`. The suite the 2026-07-29 sweep ran
  ([RESULTS-2026-07-29.md](RESULTS-2026-07-29.md)); byte-frozen, so those
  numbers stay reproducible from the text that produced them.
- **v2** — `tasks/v2/*.yaml`. The same tasks with the sweep's errata
  corrected: one incomplete ground truth, two incomplete `touches` lists, and
  the additive form of the catalogue gate. Each file's header lists its own
  errata. `yarramate-self.yaml` has no v2 — no erratum applies to it.

Never pool results across versions, and give each version its own `--out`
directory: run directories are keyed on the suite slug, which does not change
with the version.

⚠️ v2 is errata only. The sweep's other finding — the comprehension family is
saturated at both tiers on all four repositories, so H1 cannot be measured
from it — needs new multi-hop, cross-component tasks authored against the
subject repos. That authoring is still outstanding (#56).

## Corpus

Suites reference the models published in
[yarramate-gallery](https://github.com/yarrasys/yarramate-gallery) at pinned
source commits. `yarramate-self.yaml` is `headline: false` and reported
separately (self-serving ground truth). The six external suites (fastify,
httpie, miniflux, uptime-kuma, keycloak, kafka) cover every showcase currently
in the gallery, clearing the **N ≥ 5** external-repository threshold for
headline pooling. Keycloak and Kafka anchor the enterprise end of the gallery's
CLI-to-enterprise spectrum; their comprehension tasks were authored multi-hop
from the start (see "Suite versions" above on issue #56) rather than needing a
later v2 errata round.

## Running

```sh
cd docs/research/context-benchmark

# 1. validate every suite
node runner/validate-suite.mjs yarramate-benchmark-suite.schema.json \
  tasks/*.yaml tasks/v2/*.yaml

# 2. self-test the runner's workdir rules (fast, no cost)
node --test 'runner/*.test.mjs'

# 3. inspect the matrix (no side effects, no cost)
node runner/run-benchmark.mjs --suite tasks/v2/miniflux.yaml --out /tmp/bench --dry-run

# 4. live run — one suite, one condition, one capability tier (costs agent tokens)
node runner/run-benchmark.mjs --suite tasks/v2/miniflux.yaml \
  --gallery ~/work/yarrasys/projects/yarramate-gallery \
  --toolchain <dir>/node_modules/.bin \
  --out results/2026-07-29 --conditions B --label sonnet \
  --harness 'claude -p --output-format json --model sonnet'

# 5. deterministic scoring + adjudication queue
node runner/score.mjs --runs results/2026-07-29/runs.jsonl \
  --suite tasks/v2/miniflux.yaml --toolchain <dir>/node_modules/.bin
```

The harness command receives the composed prompt (condition instruction +
frozen task text) on stdin and runs with the isolated task workdir as cwd; the
pinned toolchain is prepended to its PATH so `yarramate` resolves to the
benchmark version. Model-bearing workdirs (B/C) also carry the pointer that
`yarramate init` writes (ADR 0040), delivered to every file that toolchain's
`init` writes it to (ADR 0045), and the run record snapshots the workspace's
open-catalogue count and concept count (`catalogueBaseline`) for the catalogue
scorers. Run harness agents from a hermetic path: the pilot showed user-level
agent config (memory/plugin hooks) leaking into runs non-uniformly by tier when
workdirs lived under the operator's own project tree. For the H2 tier sweep,
repeat step 4 with a different `--model`/`--label` pair. Model-maintenance
tasks are skipped under condition A (no workspace to maintain).

## What the workdir does and does not carry

The subject repository's own agent configuration — `AGENTS.md`, `AGENT.md`,
`CLAUDE.md`, `CLAUDE.local.md`, `.claude/`, `.mcp.json`, at any depth — is
moved to `<runDir>/.benchmark-quarantined/` before the run, outside the
workdir so the agent cannot read it either. It is a tier-dependent confound,
not a property of the condition: uptime-kuma's upstream anti-AI `CLAUDE.md`
produced four weak-tier one-turn refusals in the 2026-07-29 sweep and no
strong-tier ones. Every run record carries `agentConfig: { policy,
neutralized }` naming what was moved.

Quarantine runs *before* the pointer is written, and the two overlap by name:
conditions B and C deliberately place YarraMate's own pointer into `AGENTS.md`
and `CLAUDE.md`. `runner/agent-config.test.mjs` pins that ordering.

`--keep-subject-agent-config` keeps the subject's files, as an explicit
realism choice ("does an adopted repository's own instructions help or hurt?");
the record then reads `policy: "keep"`.

## Capture and flags

`score.mjs` stages the whole working tree (`git add -A`) and diffs it against
the run's pinned `baselineCommit`, writing `<runDir>/diff.patch` and the
changed-file list for the wrong-file metric. Both a file the agent created and
a change the agent committed are captured; the earlier working-tree diff
against `HEAD` saw neither.

Change and model-maintenance runs finishing in fewer than three turns are
flagged `degenerate` in the run record, in `scores.jsonl`, in the adjudication
queue, and on the scorer's console — a clean exit that did nothing otherwise
looks like an ordinary attempt.

`catalogue-not-worse` compares absolute open-question counts and suits only
tasks that do not add concepts. `catalogue-density-not-worse` compares open
questions per concept and is the form additive tasks use: the evaluator counts
subject-scoped questions once per subject, so a new concept mechanically opens
more of them, and `owner-missing` (human authority) cannot honestly be closed
for a third-party repository at all.

## What stays human

Comprehension and change verdicts: `score.mjs` emits
`adjudication-queue.jsonl` with the transcript and patch paths, ground truth or
rubric, the computed wrong-file edits, and the degenerate flag; a human records
pass/fail. Pooled deltas and confidence intervals are computed only after
adjudication — report negative results with the same prominence as positive
ones.
