# The agent-harness interface

Status: target interface, decisions recorded 2026-07-31. This document
is the map an agent harness builds against: every surface, whether it is
built or planned, the use case it serves, and which observed problem it
answers. Planned surfaces are direction, not contract, until they ship
with their own ADRs.

The division of labour behind every surface (ADR 0054): the engine
derives, verifies, and renders deterministically; the LLM supplies
judgment on top. No surface below asks the engine to read words or have
taste.

## 1. Discovery and entry — the agent arrives

| Surface | Status | Harness use case |
| --- | --- | --- |
| `init` + pointer delivery (ADR 0040/0045) | built | Repo adoption: the pointer in AGENTS.md/CLAUDE.md advertises the workspace |
| Skill via plugin marketplace | built | Loads the methodology; currently the only carrier of loop discipline |
| `yarramate-mcp` (ADR 0044, read-only) | built | Tool-calling harnesses |
| Agent card / kinds roster (#89) | planned | Learn vocabulary, aspect rules, and commands in one ~2k read |
| `yarramate design` entry | planned | Greenfield entry: an idea arrives as a prompt and the interview starts, instead of init-then-improvise |

## 2. Conception — the interview loop (greenfield core)

The loop: ask the top question → the answer arrives as prose → the
agent writes it into the model → recompute → next question. Stateless
at every step (ADR 0053): the loop resumes from model + catalogue
alone, across sessions and agents.

| Surface | Status | Harness use case |
| --- | --- | --- |
| `interrogate <catalogue> <ws>` | built | All open questions, wave-ordered, with materiality |
| `yarramate design <ws>` | planned — **stateless one-step command** | Emits exactly the top open question plus the model slice it concerns plus answering guidance; the harness loops it. No session state, headless-safe, resumable |
| `apply` batch writes (#93) | planned | One prose answer becomes one atomic validated write; any invalid op rejects the batch (no-partial-graph) |
| Deep catalogue: the ArchiMate path | planned — **motivation + business + application first** (~35–45 questions, in-wave ordering); technology/implementation follow | The "defined structured path": the interview no longer exhausts after ~10 answers |
| Adequacy conditions | planned — **linkage-depth + attestation** | See below |
| `add` / `connect` | built | Single validated writes; the weak tier's proven bridge |
| `check` | built | Gate after every write |

### Adequacy: how "filled" becomes "filled adequately"

Two mechanisms, layered, both deterministic (decision 2026-07-31):

1. **Linkage-depth conditions** — new catalogue trigger types that hold
   a question open until the blank's *neighbourhood* exists: a goal
   needs a realizing element, a stakeholder, and an influencing driver;
   a requirement needs realization and an acceptance/constraint link.
   Structural thinness caught mechanically.
2. **Attestation claims** — a question stays open until an authority
   (human, or an LLM acting as named reviewer) records an attestation
   claim in the model. The judgment lives outside the engine; its
   *record* is structural, stateless, git-reviewed, and revocable.
   Content thinness caught by explicit, auditable sign-off — the
   engine still never reads words.

Text heuristics (length, name-mention) were considered and rejected:
they erode the wiring-not-words boundary for little gain.

## 3. Advisory — query the model as an expert

| Surface | Status | Harness use case |
| --- | --- | --- |
| `context <projection|--subject> --brief` (ADR 0055) | built | Deterministic prose of a slice |
| `next` (ADR 0048) | built | Build order with evidence coverage |
| `status` (ADR 0038) | built (known gap: not backlog-oriented) | One-call orientation |
| `context --advise` composition | planned — **CLI composition command** | Deterministically composes the relevant slice + open questions + drift state into one context block; the LLM answers *as* the architect reading it. Engine supplies ground truth, never advice |

## 4. Handoff — N implementers, one model

| Surface | Status | Harness use case |
| --- | --- | --- |
| `context --brief` per slice | built | Bounded per-implementer briefs (exercised 11 times in the 2026-07-31 family) |
| `context --budget` / JSON | built | Machine consumers |
| `view`, LikeC4 export | built | Human review |

## 5. Verification and drift — is the model still true

| Surface | Status | Harness use case |
| --- | --- | --- |
| `check --strict`, `evidence`, `reconcile` | built | CI gates; contradiction detection once code exists |
| `compare` | built | State deltas |
| Drift GitHub Action | built | PR-time signal |
| One-call verdict (#92) | planned | check + open questions in one turn |

## Problem map — observed problem → owning surface

| Observed problem (evidence) | Owning surface | Status |
| --- | --- | --- |
| Weak tier never opens the workspace unprompted (sweep 0/5) | init pointer, skill, `design` entry | pointer fixed (ADR 0045); entry gap open |
| ~67k tokens per interview question (loop cost) | #89 card, #92 verdict, #93 batch | skill fix shipped; rest planned |
| A five-word goal closes `outcome-missing` forever | adequacy conditions | planned |
| Same spec modeled at 47 vs 27 concepts (sank H5) | deep catalogue granularity guidance | planned |
| Interview exhausts after ~10 answers | deep catalogue | planned |
| Agents batch the whole model; no incremental discipline | `yarramate design` | planned |
| Engine blind to requirement words (privacy-leak text passes) | permanent boundary; mitigated by `--advise` + attestations | by design |
| Lies absorbed silently pre-code (family run 1 C) | reconcile once code exists; adequacy raises the witness count before | partial by design |
| Strong tiers never use add/connect | `apply` batch | planned |
| Agents read src/profile.ts to learn kinds | #89 agent card | planned |
| `status` not backlog-oriented | status/next | open |
| Brief reads "is assigned to" both directions | brief phrase table | small fix open |

## Build order

1. Deep catalogue + adequacy condition types (extends `interrogate`;
   pure data + trigger code; the interview becomes real)
2. `apply` batch writes (#93) — the loop's write half
3. `yarramate design` — the loop's ask half, composing 1 and 2
4. `context --advise` — the advisory composition
5. #89 agent card and #92 one-call verdict as they slot in

## Open questions (second order, to settle at build time)

- Attestation claim shape: predicate namespace, who-may-attest rules,
  and whether revocation is deletion or a counter-claim.
- `design` argument surface: how a harness scopes the interview
  (whole workspace vs a wave vs a subject).
- `--advise` topic addressing: subject id, projection, or free question
  routed to a slice.
- Catalogue versioning as the path deepens (the pinned-baseline lesson
  from the benchmark applies).
