# The agent-harness interface

Status: the contract of the **0.7.0 clean break** (decided 2026-07-31,
executed under ADR 0061). Fourteen commands had accreted bottom-up,
individually justified but collectively incoherent, and pre-release with
near-zero adoption was the only cheap moment to fix that. This document
is the top-down contract the break landed on: **seven verbs, one per
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
  with it — the deep ArchiMate path (motivation + interaction +
  business + application waves first, with in-wave ordering;
  technology/implementation later) plus adequacy conditions (below).
  `--catalogue <path>` exists only as an override for teams authoring
  their own. Harnesses never pass or read catalogue files.
- **`--facilitate` speaks the room's language** (ADR 0072). Catalogue
  questions may carry an optional plain `askPlain` phrasing authored
  for stakeholder workshops; the flag prefers it in the human question
  line and falls back to the standard phrasing when a question has
  none, never blocking. Same step, same slice, same envelope: the JSON
  step carries `askPlain` additively whenever the catalogue provides
  one, so `--json` output is identical with or without the flag.
- **The step carries its answer shape** (ADR 0110). `trigger` holds the
  catalogue conditions that opened the question, verbatim, on the JSON
  step and on every report question; the human output prints a prefilled
  `yarramate/operations/v1` skeleton when the trigger maps unambiguously
  onto one operation, so the first answer lands without the author
  reverse-engineering the operations format.
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
Whole-subject deletion (`delete-concept` / `delete-relationship`)
walks through the same door: rejected while anything still references
the target, judged against the post-batch state so a subject and its
referring relationships leave in one batch (ADR 0069).
Identity edits (`rename-concept` / `rename-relationship`) move a local id
and every declarative reference to it — across documents, projections,
evidence overlays and adapter mappings — in that same batch, and are
refused rather than partially applied (ADR 0094).

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
  no LLM in the engine. On dense graphs the expansion keeps at most 12
  materiality-ordered neighbours per seed and announces what it dropped
  (ADR 0070); `--neighbours <n>` widens the cap, `--neighbours 0` lifts
  it.
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
- `ask --where <topic|subject>` — evidence-backed pointing (ADR 0068):
  the verified code locations of matched subjects, with an explicit
  coverage boundary — unobserved subjects listed, everything outside
  the model handed off to the harness's own search. Verified pointers
  outrank derived ones; the routing is stated in the output.
- Harness use: mid-task orientation, bounded context retrieval,
  design-review advice, build ordering.

### `yarramate check` — gate

[built, scope unchanged] The pass/fail verdict CI and loops key on:
structural validity always; `--strict` adds evidence contradictions.
Exit code is the contract.

- Harness use: gate after every `apply`; CI on every PR.

### `yarramate reconcile` — drift report

[built, kept separate — decision 2026-07-31] The full intent-vs-
evidence report: supported, contradicted, unknown, unobserved, plus
`stale-attestation` (ADR 0074) when a sign-off predates the current
wording of the subject it accepted, and `unconfirmed-attestation`
(ADR 0082) when the record names a recorder other than the attesting
authority. A report, never a gate; `check --strict` is the gate form
of its contradiction signal, and neither staleness nor an unconfirmed
recorder is part of that gate.

- Harness use: trust assessment before relying on a model; the CI
  drift Action's substance.

### `yarramate export` — derive artifacts

[built — ADR 0060] Persisted outputs consumed later or by
others; graphify analogues: `--wiki` / `--svg` / `--neo4j`.

- `export graph` — canonical graph v2 JSON (today's `compile`).
- `export briefs <projection>` — the handoff bundle: one brief per
  slice for N implementers (the spec-build family's `handoff/`).
- `export markdown <projection>` — human-readable document (today's
  `view`). Retired goals, outcomes, and requirements in the result
  render under a Non-goals heading (ADR 0073), as they do in briefs.
- `export rtm`: the requirements traceability matrix as a derived
  compliance bundle: one deterministic markdown matrix plus a
  machine-readable `yarramate/rtm/v1` JSON, tracing each requirement
  and constraint to its motivation lineage, realizers with lifecycle
  status, evidence verdicts, and attestations, with an authored
  `path:line` citation on every cell and unrealized requirements as
  explicit gaps (ADR 0071). Declared non-goals (ADR 0073) leave the
  coverage arithmetic as descoped rows rather than counting against it.
- `export likec4` — visualization project (today's adapter surface;
  the adapter binary remains the implementation).
- Harness use: handoff preparation, CI artifact generation,
  visualization refresh.

## Adequacy: how "filled" becomes "filled adequately"

Three mechanisms, layered, all deterministic (decision 2026-07-31,
extended 2026-08-05), living inside `design`'s internal catalogue:

1. **Linkage-depth conditions** — a question stays open until the
   blank's *neighbourhood* exists: a goal needs a realizing element, a
   stakeholder, and an influencing driver; a requirement needs
   realization and an acceptance/constraint link. Structural thinness
   caught mechanically.
2. **Attestation claims** — a question stays open until an authority
   (human, or an LLM acting as named reviewer) records an attestation
   claim in the model. `by` resolves to that authority as a subject
   reference, the same rule as `owner`; an agent transcribing on
   someone else's behalf names itself in `recordedBy` instead of
   impersonating the authority (ADR 0082). The judgment lives outside
   the engine; its record is structural, stateless, git-reviewed, and
   revocable. Content thinness caught by explicit, auditable
   sign-off — the engine still never reads words.

3. **Distinctness claims**: the same pattern applied to identity
   (ADR 0077). The `near-duplicate` condition opens a hygiene question
   when two subjects of one kind resemble each other closely enough to be
   the same thing under two names. This is not the engine judging a name:
   it compares two strings under a stated normalization, deterministically
   and with no model involved. A false positive is dismissed by recording
   a `distinctFrom` reference, which is itself a claim, so the answer
   lives in the model, is read symmetrically from either side of the pair,
   and survives re-running the interview.

Text heuristics (length, name-mention) were considered and rejected:
they erode the wiring-not-words boundary for little gain.

## Naming a subject more than one way

Concepts carry an optional `aka` list of alternative labels (ADR 0076),
compiled to `yarramate/concept/alias` claims. A harness should record the
words a team actually uses for a subject, including abbreviations, legacy
names, and codenames: `ask` free-text seeding matches them at the same
weight as the name, so the team's own vocabulary addresses the model.
Renderers keep printing the preferred `name` only, so aliases cost no
context budget in a brief. Aliases also feed near-duplicate detection
directly, because a genuine duplicate very often reuses the other
subject's alias.

## Recording where a subject went

A subject that is renamed, split, or merged loses its history unless the
succession is recorded, because nothing in two documents distinguishes a
rename from a coincidence of naming. Concepts carry an optional
`supersedes` list naming the subjects whose responsibility they took over
(ADR 0080), compiled to `yarramate/lineage/supersedes` claims.

A harness should write it at the moment it introduces the replacement,
which is the moment it knows. One predicate covers every case: name one
predecessor for a rename, several for a merge, and let several successors
name one predecessor for a split. Do **not** retire the predecessor merely
because it has a successor; retirement is its own decision and the
transition period during which both run is real.

Briefs read the claims in both directions, so the replacement reads
"Succeeds ..." and the original reads "Superseded by ...", which is how a
later session recovers the refactoring that a diff alone does not explain.

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
| ~67k tokens per interview question (loop cost) | `design` (one-step), `apply` (batch), agent card #89 | owners shipped (ADRs 0057, 0058, 0061) |
| A five-word goal closes `outcome-missing` forever | `design` adequacy conditions | shipped (ADR 0056) |
| Same spec modeled at 47 vs 27 concepts (sank H5) | `design` catalogue granularity guidance | planned |
| Interview exhausts after ~10 answers | `design` deep catalogue | shipped (ADR 0056) |
| Agents batch the whole model; no incremental discipline | `design` | owner shipped (ADR 0058) |
| Harness must know catalogue file paths | `design` (catalogue internal) | fixed by this contract |
| Fourteen sibling commands, four of them just to read | `ask` / `export` consolidation | fixed by this contract |
| Engine blind to requirement words (privacy-leak text passes) | permanent boundary; mitigated by `ask --advise` + attestations | by design |
| Lies absorbed silently pre-code (family run 1 C) | `reconcile` once code exists; adequacy raises the witness count before | partial by design |
| Strong tiers never use add/connect | `apply` batch | owner shipped (ADR 0057) |
| Agents read src/profile.ts to learn kinds | agent card #89 (entry) | shipped (`ask --kinds`, ADR 0061) |
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

- Attestation claim shape: SETTLED (ADR 0056, refined by ADR 0082) —
  `yarramate/attestation/<topic>` claims, deletion-revocation, git-reviewed
  authority resolved as a subject reference, with the recorder carried
  beside it.
- Where the standalone `evidence` evaluation lands: SETTLED (ADR 0061) —
  gone as a public surface; `reconcile` reports, `check --strict` gates,
  `yarramate/evidence-report/v1` remains a library-level format.
- Catalogue versioning: SETTLED (ADR 0063, with the 0.4 waves) —
  honest reopen, `since` delta annotations, semver discipline (minor
  is additive), no pinning.
- Alternative labels: SETTLED (ADR 0076): an optional `aka` list
  compiling to `yarramate/concept/alias` claims, matched by `ask`
  seeding at the same weight as the name, never rendered. Hidden labels
  and relationship aliases deliberately deferred; both stay additive.
- Near-duplicate subjects: SETTLED (ADR 0077): the `near-duplicate`
  catalogue condition, deterministic and lexical, never a `check`
  error. A dismissal is a `distinctFrom` claim, read symmetrically, so
  it survives re-running the interview.
- Succession: SETTLED (ADR 0080): one `supersedes` list on concepts
  compiling to `yarramate/lineage/supersedes`, authored on the successor
  and read both ways. Cardinality is the shape, so rename, split, and
  merge need no separate vocabulary. Retirement is deliberately not
  coupled. The RTM and a catalogue question about retired subjects with
  no successor are deferred, the latter because retired subjects are
  outside the interrogation index by ADR 0064 and because "it went
  nowhere" is an answer the question would have to accept.
