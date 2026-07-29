# Context benchmark (research implementation)

Status: research artifact — nothing here is wired into the compiler, CLI, or
package exports. The protocol is frozen in [DESIGN.md](DESIGN.md); this
directory adds the task suites and the runner that make it executable.

```text
context-benchmark/
  DESIGN.md                              # frozen protocol: hypotheses, conditions, metrics
  yarramate-benchmark-suite.schema.json  # draft schema for yarramate/benchmark-suite/v1
  tasks/                                 # frozen task suites, one per repository
  runner/
    validate-suite.mjs                   # schema + cross-checks (ids, family minimums, prompt leakage)
    conditions.mjs                       # condition A/B/C instructions (B and C verbatim-identical)
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

## Corpus

Suites reference the models published in
[yarramate-gallery](https://github.com/yarrasys/yarramate-gallery) at pinned
source commits. `yarramate-self.yaml` is `headline: false` and reported
separately (self-serving ground truth). ⚠️ Headline pooling wants **N ≥ 5**
external repositories; the gallery currently provides 4 — add a fifth showcase
before publishing pooled numbers.

## Running

```sh
cd docs/research/context-benchmark

# 1. validate every suite
node runner/validate-suite.mjs yarramate-benchmark-suite.schema.json tasks/*.yaml

# 2. inspect the matrix (no side effects, no cost)
node runner/run-benchmark.mjs --suite tasks/miniflux.yaml --out /tmp/bench --dry-run

# 3. live run — one suite, one condition, one capability tier (costs agent tokens)
node runner/run-benchmark.mjs --suite tasks/miniflux.yaml \
  --gallery ~/work/yarrasys/projects/yarramate-gallery \
  --toolchain <dir>/node_modules/.bin \
  --out results/2026-07-29 --conditions B --label sonnet \
  --harness 'claude -p --output-format json --model sonnet'

# 4. deterministic scoring + adjudication queue
node runner/score.mjs --runs results/2026-07-29/runs.jsonl \
  --suite tasks/miniflux.yaml --toolchain <dir>/node_modules/.bin
```

The harness command receives the composed prompt (condition instruction +
frozen task text) on stdin and runs with the isolated task workdir as cwd; the
pinned toolchain is prepended to its PATH so `yarramate` resolves to the
benchmark version. For the H2 tier sweep, repeat step 3 with a different
`--model`/`--label` pair. Model-maintenance tasks are skipped under condition
A (no workspace to maintain).

## What stays human

Comprehension and change verdicts: `score.mjs` emits
`adjudication-queue.jsonl` with the transcript path, ground truth or rubric,
and the computed wrong-file edits; a human records pass/fail. Pooled deltas
and confidence intervals are computed only after adjudication — report
negative results with the same prominence as positive ones.
