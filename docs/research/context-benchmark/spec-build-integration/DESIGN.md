# Spec-build, integration instance: many services, many agents, one map

Status: design draft for review. No spec is frozen, no mock exists, no
run has happened. This document pins the scenario, the arms, and the
instruments before any of them are built, in the discipline
`../DESIGN-HANDOFF-FAMILY.md` established: the demo tells stories, the
experiment produces numbers, and the two never mix.

## Why a second instance

The Conduit instance tests one designer handing one implementer one
application. It cannot see the claim YarraMate actually stakes for the
integration domain: that a checked model is the better **handover
artifact between agents** when a solution is several services whose
correctness lives in cross-service properties no single service's code
can show.

Enterprise integration is where that claim is sharpest. Idempotency,
rate-limit compliance, replay, and write-path ownership are decisions
made at design time and *distributed* across services at build time.
An implementer holding one service cannot read them out of its own
slice; either the design carries them to every seat, or they are
re-invented inconsistently at each seat. That is the non-substitutable
case the 2026-07-29 sweep showed reading-benchmarks cannot reach.

## The scenario: contact synchronization, API-led

A bounded, bespoke integration solution. No framework product joins the
suite; the enterprise-integration character comes from the problem, not
from a vendor.

**The fixed world (given, built once, frozen with the spec):**

- **`crm-mock`**: a system of record with a REST resource per contact.
  Deliberately hostile in the ways real vendors are: optimistic
  concurrency by revision, a global rate limit with `429` +
  `Retry-After`, an injectable outage mode, and a duplicate-detection
  rule that rejects same-email creates.
- **`channel-mock`**: an event source that emits contact-edit webhooks,
  with at-least-once delivery: duplicates and out-of-order deliveries
  are injected deterministically from a seed.

Both mocks are harness fixtures in the spirit of `reference-stub.mjs`:
test-the-tests infrastructure, never arm artifacts, bespoke so no
training-data contamination applies to them.

**The build (what the agents produce):** the middle. An API-led layering
is the *reference* shape (experience / process / system), but arms are
scored on properties, not on shape: a solution that meets every
acceptance property with two services instead of three loses nothing on
conformance and is scored honestly by the structural instrument as a
divergence, not a failure.

**The frozen delta (novel requirements, committed before any run):**

1. **Idempotent apply**: the same webhook delivered N times lands exactly
   one CRM write; a replayed delivery after success is acknowledged
   without a second write.
2. **Rate-limit compliance**: under a mock-enforced budget, no update is
   lost and no request is sent while a `Retry-After` stands. Bounded
   retry, then dead-letter.
3. **Replayable dead letters**: a delivery parked during a CRM outage is
   replayable after recovery by an operator call, exactly once.
4. **Ordering under concurrency**: two edits to one contact resolve to
   the later edit by channel timestamp, never interleaved fields.
5. **A published contract**: the inbound surface is declared (schema
   file in the repo) and conformance-checked; an incompatible payload is
   refused at the edge, never dead-lettered.

Each requirement is an end-to-end `hurl` (or equivalent) sequence
driving `channel-mock` and asserting against `crm-mock` state. All five
are cross-service properties: none is checkable inside one service.

## Arms

| Arm | Design phase | Build phase |
| --- | --- | --- |
| A | designer writes prose design from the spec | each implementer gets the full prose design + spec |
| B | designer builds a YarraMate model with the 1.0 CLI loop (design/apply/check) | each implementer gets the spec + a **bounded brief sliced from the model** for their service, plus CLI access |

**The multi-implementer split is the instance's point.** The build phase
runs one implementer agent per service, fresh context each, no shared
memory. Arm A's handover is prose; arm B's is the model. H-int:
cross-service conformance (the five properties above) is where B
separates from A, if it separates anywhere. Single-service unit floors
are expected to saturate in both arms, as Conduit found.

Repeats: 3 runs per arm minimum, per the pre-registered repeats rule.
Tier sweep (H2) applies unchanged: same frozen materials, implementer
tier varied.

## Instruments (all three reused from the Conduit runner)

1. **Conformance**: the frozen delta suites against the running
   composition. The floor for a run to count, and the per-property
   pass/fail that is the headline number.
2. **Convergence**: a reference model of the completed solution,
   authored with the materials and given to no arm, compiled to
   structural assertions (services that exist, write paths that hold,
   who dedupes). Scores intent-match identically across arms.
3. **Promise-scoring**: what the design claimed against what the build
   does, unchanged.

## Decisions taken now, so they are not taken later under pressure

- **Vocabulary**: arm B designs against stock `yarramate/core@0.1`.
  The api-led profile and pattern kinds (#268) are *not* provided; when
  #268 ships, a later suite version may add a C arm with the pattern
  vocabulary, versioned beside this one, never pooled.
- **Contamination**: the contact-update fixture in the YarraMate
  repository is prior art for this scenario. It does not ship in the
  npm package (`files` whitelist excludes `test/`), so a pinned
  toolchain cannot leak it; the spec text below must still be written
  fresh, not copied from the fixture, and the reference model authored
  after the spec freezes.
- **Mock determinism**: every injected fault (duplicate, reorder,
  outage window, 429 budget) derives from a seed recorded in the run
  directory, so a failed property is replayable.
- **No orchestrator agent**: service implementers run independently.
  Composition is by the frozen docker-compose (or equivalent) in the
  materials, so integration failures are attributable to handover, not
  to a scheduler agent's skill.

## What this does not test

Greenfield conception (the spec is given, not elicited), model
maintenance over time, and the visual editor. One instance, one claim:
the model as the handover artifact across parallel implementers.

## Build plan, in freeze order

1. Mocks + composition + the five delta suites, self-tested against a
   reference stub of the middle (test-the-tests, then the stub is set
   aside).
2. Spec text (`SPEC.md`) written fresh; frozen with the suites in one
   commit before any run.
3. Reference model authored; convergence assertions derived.
4. Prompts (designer-A/B, implementer) adapted from `../spec-build/prompts`.
5. Runner adaptation: multi-implementer fan-out is the only new
   machinery; everything else is reuse.
6. Dry run with the stub standing in for every service; then arms.

Estimated cost per full A/B comparison at 3 repeats, two tiers:
comparable to the Conduit pilot's, plus one designer run per arm;
recorded properly in the results directory when known, not guessed
here.
