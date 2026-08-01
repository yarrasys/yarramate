# The agent-harness interface

Status: target contract for **0.7.0, a clean break** (decided
2026-07-31). The current fourteen commands accreted bottom-up and are
individually justified but collectively incoherent; pre-release with
near-zero adoption is the only cheap moment to fix that. This document
is the top-down contract the break lands on: **seven verbs, one per
lifecycle stage**. Planned surfaces are direction, not contract, until
they ship with their own ADRs.

The division of labour behind every verb (ADR 0054): the engine
derives, verifies, and renders deterministically; the LLM supplies
judgment on top. No verb asks the engine to read words or have taste.

## The seven verbs

```text
init → design → apply → ask → check → reconcile → export
create  fill    write   read  gate    drift       derive
```

The rule separating `ask` from `export` is borrowed from graphify's
query/wiki split: **does the output outlive the invocation?** An answer
consumed now by the asking agent is `ask`; a persisted artifact
consumed later by someone else is `export`. Same renderers underneath,
two intents.

### `yarramate init` — create

[built, unchanged] Scaffolds the workspace, delivers the pointer
(ADR 0040/0045) so harnesses discover it.

- Harness use: repo adoption; the greenfield entry hands off to
  `design` immediately after.

### `yarramate design` — fill, guided

[built — ADR 0058; `--subject` narrows, no wave override] The conception loop's ask-half. Each invocation
is stateless (ADR 0053) and emits exactly the **top open question** —
materiality-ordered — plus the model slice it concerns plus answering
guidance; the harness/LLM loops: answer arrives as prose → agent
translates it into `apply` operations → re-invoke `design`.

- **The catalogue is internal.** It ships inside the product, versioned
  with it — the deep ArchiMate path (motivation + business +
  application waves first, ~35–45 questions with in-wave ordering;
  technology/implementation later) plus adequacy conditions (below).
  `--catalogue <path>` exists only as an override for teams authoring
  their own. Harnesses never pass or read catalogue files.
- Today's `interrogate` demotes to internal machinery; the full
  open-questions report remains reachable as a read (see `ask`).
- Harness use: greenfield conception from a one-line idea; enrichment
  of an existing model; resumable across sessions and agents because
  nothing is stored but the model.

### `yarramate apply` — write, validated

[built — ADR 0057, write path ADR 0062] All model writes: single
operations and **atomic batches** (an operations document; any invalid
op rejects the whole batch, preserving no-partial-graph). Structurally
incapable of emitting YM404s — the weak tier's proven bridge, now cheap
enough for the strong tier (one answer = one call). Writes are spliced,
never re-serialized: an apply diff is exactly the answer it landed.
Updates enrich by default and retract explicitly (`remove`), so the
assert → catch → retract loop closes through one audited surface.

- Harness use: landing a design answer; discovery-journey authoring;
  maintenance edits.

### `yarramate ask` — read, interactive

[built — ADR 0059] One entry point for every consumed-now
read; graphify analogues: `query` / `explain` / `path`.

- `ask` (bare) — orientation: the status verdict, drift summary, and
  the backlog-shaped roster slice, planned items first (decided
  2026-08-01; closes the status backlog gap).
- `ask --subjects` — the full filterable roster: id, kind, name,
  one-line description, status (decided 2026-08-01) — the discovery
  surface `--subject` flags depend on, and the same index free-text
  seeding matches against.
- `ask "<free text>"` — the default addressing mode (decided
  2026-08-01): terms match concept names, ids, and descriptions to find
  seed subjects, then the existing one-hop connected-neighbourhood
  machinery renders the slice — graphify's query model, deterministic,
  no LLM in the engine.
- `ask <subject|projection>` — precise addressing: the slice as a brief
  (ADR 0055) or digest/JSON (`--budget`, `--json`).
- `ask --advise <topic>` — the expert composition: slice + open
  questions + drift state assembled deterministically into one context
  block the LLM answers *as* the architect. The engine composes ground
  truth; it never advises.
- `ask --next` — dependency-ordered planned work (ADR 0048).
- `ask --open` — the full open-questions report (today's interrogate
  output as a read).
- `ask --compare <from> <to>` — state delta (today's `compare`).
- Harness use: mid-task orientation, bounded context retrieval,
  design-review advice, build ordering.

### `yarramate check` — gate

[built, scope unchanged] The pass/fail verdict CI and loops key on:
structural validity always; `--strict` adds evidence contradictions.
Exit code is the contract.

- Harness use: gate after every `apply`; CI on every PR.

### `yarramate reconcile` — drift report

[built, kept separate — decision 2026-07-31] The full intent-vs-
evidence report: supported, contradicted, unknown, unobserved. A
report, never a gate; `check --strict` is the gate form of its
contradiction signal.

- Harness use: trust assessment before relying on a model; the CI
  drift Action's substance.

### `yarramate export` — derive artifacts

[built — ADR 0060] Persisted outputs consumed later or by
others; graphify analogues: `--wiki` / `--svg` / `--neo4j`.

- `export graph` — canonical graph v2 JSON (today's `compile`).
- `export briefs <projection>` — the handoff bundle: one brief per
  slice for N implementers (the spec-build family's `handoff/`).
- `export markdown <projection>` — human-readable document (today's
  `view`).
- `export likec4` — visualization project (today's adapter surface;
  the adapter binary remains the implementation).
- Harness use: handoff preparation, CI artifact generation,
  visualization refresh.

## Adequacy: how "filled" becomes "filled adequately"

Two mechanisms, layered, both deterministic (decision 2026-07-31),
living inside `design`'s internal catalogue:

1. **Linkage-depth conditions** — a question stays open until the
   blank's *neighbourhood* exists: a goal needs a realizing element, a
   stakeholder, and an influencing driver; a requirement needs
   realization and an acceptance/constraint link. Structural thinness
   caught mechanically.
2. **Attestation claims** — a question stays open until an authority
   (human, or an LLM acting as named reviewer) records an attestation
   claim in the model. The judgment lives outside the engine; its
   record is structural, stateless, git-reviewed, and revocable.
   Content thinness caught by explicit, auditable sign-off — the engine
   still never reads words.

Text heuristics (length, name-mention) were considered and rejected:
they erode the wiring-not-words boundary for little gain.

## Migration map (0.7.0 clean break — EXECUTED, ADR 0061)

| Before 0.7.0 | Now |
| --- | --- |
| `init` | `init` (unchanged) |
| `add`, `connect` | `apply` (one atomic operations batch) |
| `new projection` | author the projection file directly; validated by `check` (decision at build time — no scaffolding op) |
| `interrogate <catalogue> <ws>` | `design` machinery; report via `ask --open [--catalogue]` |
| `status` | `ask` (bare) |
| `context <projection>` / `--subject` / `--budget` / `--brief` | `ask <slice>` (brief is the default rendering) |
| `next` | `ask --next` (whole workspace) |
| `compare` | `ask --compare` |
| `view` | `export markdown` (interactive form: `ask <slice>`) |
| `compile` | `export graph` |
| `check` / `--strict` | `check` (unchanged) |
| `evidence` | removed as a surface; `reconcile` reports, `check --strict` gates (settled — see open questions) |
| `reconcile` | `reconcile` (unchanged) |
| adapter binaries (`yarramate-likec4`, `yarramate-graphify`) | `export likec4` fronts the likec4 adapter as a separate process; direct binaries remain for advanced use |
| MCP adapter | four read-only tools: `ask`, `design`, `check`, `reconcile` |

Core contract, skill, MCP, README, and docs are rewritten to the seven
verbs. No aliases: old names are removed, and the release notes carry
the map above. `ask --kinds` ships alongside (#89): the declarable
vocabulary as a read.

## Problem map — observed problem → owning verb

| Observed problem (evidence) | Owner | Status |
| --- | --- | --- |
| Weak tier never opens the workspace unprompted (sweep 0/5; AGENTS.md read in 0 of 28 runs) | `init` pointer + skill + `design` entry | pointer shipped; entry gap open |
| ~67k tokens per interview question (loop cost) | `design` (one-step), `apply` (batch), agent card #89 | planned |
| A five-word goal closes `outcome-missing` forever | `design` adequacy conditions | planned |
| Same spec modeled at 47 vs 27 concepts (sank H5) | `design` catalogue granularity guidance | planned |
| Interview exhausts after ~10 answers | `design` deep catalogue | planned |
| Agents batch the whole model; no incremental discipline | `design` | planned |
| Harness must know catalogue file paths | `design` (catalogue internal) | fixed by this contract |
| Fourteen sibling commands, four of them just to read | `ask` / `export` consolidation | fixed by this contract |
| Engine blind to requirement words (privacy-leak text passes) | permanent boundary; mitigated by `ask --advise` + attestations | by design |
| Lies absorbed silently pre-code (family run 1 C) | `reconcile` once code exists; adequacy raises the witness count before | partial by design |
| Strong tiers never use add/connect | `apply` batch | planned |
| Agents read src/profile.ts to learn kinds | agent card #89 (entry) | planned |
| `status` not backlog-oriented | `ask` (bare) | fixed (ADR 0059) |
| Brief reads "is assigned to" both directions | brief renderer phrase table (`ask`/`export`) | small fix open |

## Build order (the 0.7.0 arc)

1. Deep catalogue + adequacy condition types [done, ADR 0056]
2. `apply` (#93 shape) — the loop's write half [done, ADR 0057]
3. `design` (#103) — the loop's ask half, catalogue internal [done,
   ADR 0058]
4. `ask` — consolidation of status/context/next/compare + `--advise`
   (#105) + `--open` [done, ADR 0059]
5. `export` — consolidation of compile/view/likec4/briefs [done,
   ADR 0060]
6. Contract/skill/MCP/docs rewrite; release 0.7.0 [done, ADR 0061]
7. Agent card (#89) folds into the skill/entry surfaces along the way
   [done — `ask --kinds` + skill/pointer rewrite, ADR 0061]

## Open questions

- Attestation claim shape: SETTLED (ADR 0056) — `yarramate/attestation/<topic>`
  claims, deletion-revocation, git-reviewed authority.
- Where the standalone `evidence` evaluation lands: SETTLED (ADR 0061) —
  gone as a public surface; `reconcile` reports, `check --strict` gates,
  `yarramate/evidence-report/v1` remains a library-level format.
- Catalogue versioning as the path deepens (the pinned-baseline lesson
  from the benchmark applies) — still open; revisit when the
  technology/implementation waves land.
