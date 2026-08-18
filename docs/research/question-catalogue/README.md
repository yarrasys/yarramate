# Question catalogue (research draft)

Status: draft for review — not a normative contract. Nothing here is wired
into the compiler, CLI, or package exports.

A question catalogue is the versioned, opinionated artifact behind the
proposed enrichment journey: after `init` and initial discovery, an agent
interviews the workspace — answering what evidence can answer and escalating
genuine design decisions to a human. This directory contains:

- `yarramate-question-catalogue.schema.json` — the research draft of the
  schema. The normative copy now ships as
  `schema/yarramate-question-catalogue.schema.json` (it omits `extends`,
  which v1 defers — ADR 0053);
- `evaluate-catalogue.mjs` — reference evaluator demonstrating that every
  trigger is deterministic against a compiled graph-v2 workspace.

The seed catalogue graduated to the product: it ships as
`catalogues/core-enrichment.yaml`, and the gap engine runs inside
`yarramate design` and `yarramate ask --open` (ADR 0053; the standalone
`interrogate` verb was folded into those two by the 0.7.0 clean break, ADR
0061). This directory remains the design record and the standalone
reference implementation.

## Evaluation model

- A question binds a **trigger**: one or more deterministic conditions over
  the compiled graph (AND). The question is **open** wherever the trigger
  matches and **closed** when it no longer matches.
- Interview state is **recomputed, never stored**. Re-running the evaluation
  after any edit yields exactly the still-open questions. No session files,
  no second canonical store.
- `scope: subject` questions evaluate once per subject matched by a selector
  whose vocabulary mirrors the projection query (`kinds`, `kindMatching`,
  `statuses`, `documents`). `scope: workspace` questions evaluate once.
- Every question must state its **materiality** — the decision its answer
  changes. A question that cannot is deleted, not softened.
- **authority** encodes escalation: `evidence` (agent may propose from
  repository evidence), `human` (genuine design decision), `either`
  (evidence proposes, human confirms). In every case an answer lands as a
  reviewable native-document diff; evidence never silently authors intent.

### Trigger conditions (v1 draft)

| Condition | Scope | Open when |
| --- | --- | --- |
| `missing-claim` | subject | subject has no claim with `predicate` |
| `missing-relationship` | subject | no relationship claim of `kinds` touches the subject in `direction` |
| `isolated` | subject | subject participates in no relationship **and** is not the target of any reference-bearing claim |
| `no-subject-of-kind` | workspace | no concept of `kinds` exists |
| `no-state-defined` | workspace | no architecture state is declared |

## Pressure test against the self-model

Run against this repository's compiled workspace:

```sh
yarramate ask .yarramate/workspace.yaml --open --catalogue catalogues/core-enrichment.yaml
```

Or through the standalone reference evaluator. Validate against the
normative schema under `schema/`: the shipped catalogue has moved past the
research draft in this directory (its trigger shapes no longer validate
against the draft), and the evaluator reads the graph `export graph` writes:

```sh
yarramate export graph .yarramate/workspace.yaml --out /tmp/graph.json
node docs/research/question-catalogue/evaluate-catalogue.mjs \
  schema/yarramate-question-catalogue.schema.json \
  catalogues/core-enrichment.yaml \
  /tmp/graph.json
```

First run (2026-07-29, v0.3.3 self-model): **70 open questions**, including
19 concepts without owners, 7 services without a declared consumer, 34
undescribed concepts, one unrealized goal (Shared architecture context), and
no stakeholder/driver concepts at all. The findings are plausible on sight,
which is the point: the triggers find real gaps without an LLM in the loop.

Two interview sessions later (same day): **0 open questions**. Session one
closed the motivation and business waves (70 → 39) through four interactive
decisions and evidence-backed proposals; session two closed the hygiene wave
(descriptions for every significant concept, two previously unmodeled LikeC4
result objects) and shipped catalogue 0.2. Interview state was recomputed
from the graph each session — nothing was stored between them.

## Open decisions

1. **`kindMatching: descendants`** needs profile lineage; graph v2 carries
   profile identities only. The gap engine should resolve descendants through
   the library's profile resolution. The reference evaluator matches exactly
   and says so.
2. **`isolated` semantics.** First draft counted only relationship claims and
   false-positived an actor referenced by nine ownership claims. Current
   draft: reference-bearing claims (ownership, identified references,
   constraints) also express participation. Revisit whether that list should
   be explicit in the schema.
3. **Serving direction.** `service-consumer-unknown` assumes services serve
   outward (service → consumer). Models that attach serving to components
   instead will under-fire. May need an `any` direction or an endpoint-role
   refinement.
3a. **`information-unaccessed` is too narrow** (found while dogfooding the
   first enrichment session, 2026-07-29). Schema dataObjects legitimately
   participate through outgoing `realization` "describes" edges, not incoming
   access; 3 of 5 residual matches were false positives of this shape.
   **Resolved in catalogue 0.2**: the trigger now accepts any access or
   realization relationship in any direction — no schema change was needed,
   which is the versioned-catalogue mechanism working as intended.
4. **Where catalogues live.** Options: workspace manifest entries (like
   evidence), standalone files passed to a future `yarramate interrogate`,
   or shipped with the skill. Draft assumes standalone explicit files,
   matching the CLI's explicit-source convention. **Resolved**: standalone
   explicit files, passed as `--catalogue` to `design` and `ask --open`; the
   seed catalogue ships in the package under `catalogues/`.
5. **`extends` composition semantics** (union, no shadowing — mirroring
   profiles) are declared in the schema but deferred to the gap engine.
6. **Ranking.** Open-question ordering (e.g. by graph centrality of the
   subject) is an engine concern, deliberately not encoded in the catalogue.
