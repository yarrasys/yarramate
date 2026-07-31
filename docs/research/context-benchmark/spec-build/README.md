# Spec-build experiment family

The executable half of `../DESIGN-HANDOFF-FAMILY.md` (pre-registered
2026-07-31): build RealWorld/Conduit from its published spec plus a
frozen novel delta, comparing a design-document handoff (arm A), briefs
rendered from a checked YarraMate model (arm B), and briefs from the
same model with injected lies (arm C).

```text
spec-build/
  SPEC-DELTA.md        # FROZEN: the three novel requirements + pinned base spec
  delta-hurl/          # FROZEN: their acceptance tests (upstream Hurl conventions)
  prompts/             # FROZEN: designer-A/B, implementer, extension prompts
  RUNBOOK.md           # how to execute a run matrix
  runner/
    lib.mjs            # shared plumbing (spec cache, harness, records)
    run-design.mjs     # design phase, arms A and B
    derive-arm-c.mjs   # arm C = B's workspace + inject-lies + re-render
    render-briefs.mjs  # mechanical handoff: context --brief per slice
    inject-lies.mjs    # same-kind endpoint rotation, check must stay green
    run-build.mjs      # build phase + gate + promise scoring
    conformance.mjs    # run.sh lifecycle + upstream & delta Hurl suites
    score-promises.mjs # declared-name floor + DEVIATIONS.md
    convergence.mjs    # pairwise Jaccard across repeat runs
    reference-stub.mjs # test-the-tests fixture (never an arm artifact)
```

Frozen files must not change once runs begin; the runner is operational
and patchable with patches recorded alongside results.
