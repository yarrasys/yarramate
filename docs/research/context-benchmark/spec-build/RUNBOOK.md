# Spec-build family: runbook

Executes the experiment pre-registered in `../DESIGN-HANDOFF-FAMILY.md`.
The spec delta and its acceptance tests (`SPEC-DELTA.md`, `delta-hurl/`)
are frozen; this runbook and the runner are operational and may be
patched, with patches recorded in the results directory.

## Prerequisites

- `hurl` ≥ 6 (`brew install hurl`) — conformance runner
- `claude` CLI (or any harness command that reads the prompt on stdin,
  runs in the workdir, and prints `claude -p --output-format json`-shaped
  JSON to stdout)
- a **pinned toolchain**: `npm install` the exact yarramate build under
  test into a scratch prefix; pass its `node_modules/.bin` as
  `--toolchain`. The brief renderer (`context --brief`, ADR 0055) must be
  present. Record the package version/commit in the results directory.
- network on first run (the runner clones the pinned RealWorld commit
  into `<out>/cache`)

Self-test without spending tokens (the reference stub is a
test-the-tests fixture only — never an arm artifact):

```sh
cd docs/research/context-benchmark/spec-build
PORT=3971 node runner/reference-stub.mjs &
hurl --test --jobs 1 --variable host=http://localhost:3971 \
  --variable uid=smoke$$ delta-hurl/*.hurl
kill %1
```

## Phases (per run number N ∈ {1,2,3})

```sh
cd docs/research/context-benchmark/spec-build/runner
OUT=<results-dir>; TC=<toolchain-bins>; TIER='claude -p --model <model> --output-format json'

# 1. Design phase (A and B are agent runs; C is derived, no agent)
node run-design.mjs --arm A --run N --out $OUT --harness "$TIER"
node run-design.mjs --arm B --run N --out $OUT --toolchain $TC --harness "$TIER"
node derive-arm-c.mjs   --run N --out $OUT --toolchain $TC \
  --kinds access,serving --consistent

# 2. Build phase (fresh implementer agents; C's run N builds from B's
#    lie-injected run N — the pre-registered mapping)
node run-build.mjs --arm A --run N --out $OUT --harness "$TIER"
node run-build.mjs --arm B --run N --out $OUT --toolchain $TC --harness "$TIER"
node run-build.mjs --arm C --run N --out $OUT --toolchain $TC --harness "$TIER"

# 3. Scoring (deterministic floor; human adjudication on top, per the
#    no-LLM-judging rule)
node convergence.mjs --mode names --runs $OUT/design/A/run-1 $OUT/design/A/run-2 $OUT/design/A/run-3
node convergence.mjs --mode names --runs $OUT/design/B/run-1 $OUT/design/B/run-2 $OUT/design/B/run-3
node convergence.mjs --mode files --runs $OUT/build/A/run-1 $OUT/build/A/run-2 $OUT/build/A/run-3
node convergence.mjs --mode files --runs $OUT/build/B/run-1 $OUT/build/B/run-2 $OUT/build/B/run-3
```

Every run appends one record to `$OUT/runs.jsonl` (phase, arm, run,
metrics, gate, promise scores). `--dry-run` on the two agent runners
prints the plan without materializing or spending anything.

## The gate and the scores

- **Gate**: `conformance.mjs` — upstream Hurl suite AND delta suite must
  pass against the implementation's `run.sh`. Failing runs are excluded,
  never ranked. Applied automatically by `run-build.mjs`; re-run
  manually with `--suites upstream,delta` to reproduce.
- **Promise-keeping floor**: `score-promises.mjs` — declared component
  names (A: `## Components` bullets; B/C: planned concepts) found or
  missing in the implementation, plus `DEVIATIONS.md` count. Boundary
  violations beyond naming need human adjudication; the scorer never
  claims more than name presence.
- **Convergence**: pairwise Jaccard across an arm's repeat runs. The
  pre-registered guard: if arm A converges as strongly as B, the spec is
  forcing the structure and the metric is uninformative for this task.
- **Cost**: turns/tokens/USD per run from the harness JSON, in
  `runs.jsonl`.

## Order of operations and blinding

- Design runs before any build run; a build run only ever sees
  `spec/` + `handoff/`.
- Implementers and designers are separate agent sessions; implementer
  prompts never mention YarraMate, arms, or the experiment.
- Arm C derives from arm B **after** B's design run completes and before
  any build run of either; `lies.json` records the injected rotations.
- **Lie injection for the full family is structural AND self-consistent**
  (`--kinds access,serving --consistent`), pre-registered from the
  pilot's finding 5: self-contradictory lies get caught by the reader
  (an injector artifact, not a fair H6 test), while self-consistent
  ones are the danger case. `--consistent` strips the lied edge's free
  text and records the originals in `lies.json`.
- Pilot before the full family: run N=1 across all three arms
  (~$20–30) and inspect every artifact before committing to N=2,3.

## Extension phase (optional, after the main family)

`prompts/extension.md` (tag subscription) extends a finished build with
a fresh agent. Its acceptance tests are **not yet frozen** — freeze them
in `extension-hurl/` before running that phase, same discipline as the
delta.
