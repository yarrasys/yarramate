# Elicitation pilot (2026-07-31)

Status: pilot record, n = 1–2 per cell. Nothing here is a publishable
number; this documents a protocol that worked, the artifacts it produced,
and the findings worth designing the real experiment around. The
follow-on experiment is the elicitation family proposed for the
spec-build design (PR #85); the commands used are the shipped
`yarramate@main` CLI at commit `c8ffc78` (`interrogate`, ADR 0053).

## Question

Given a deliberately thin product request, does the deterministic gap
engine change **which question an agent asks next** — and does that hold
across capability tiers?

The stimulus, verbatim, chosen for its gaps:

> "Generate an online todo application on cloudflare that lets user CRUD
> todo task. It also reminds the user if a todo task when the task is due
> by sending a reminder to user"

## Protocol

Two arms, three model tiers (Fable 5, Sonnet 5, Haiku 4.5), every agent a
fresh context with no knowledge of the product conversation.

- **Freehand**: the request plus "state the single most important next
  question and why, then the next five in order". No tools permitted.
- **Tool-equipped**: the request, an isolated empty workdir, the yarramate
  CLI, the shipped `catalogues/core-enrichment.yaml`, and an instruction
  to read `SKILL.md` first, structure **only what the request states**
  (faithfulness over completeness), get `check` passing, run
  `interrogate`, and report the single next question with its materiality.

The tool arm was *told* to use the tool: this measures operability, not
discoverability. The 2026-07-29 sweep already showed the weak tier does
not discover the workspace unprompted; that delivery problem is real and
separate.

## Results

| Tier | Freehand: first question | Freehand: motivation Qs | Tool: loop operated | Tool: open items | Tool: next question |
| --- | --- | --- | --- | --- | --- |
| Fable ×2 | reminder delivery channel (both runs) | 0 of 12 | ✅ 0 errors, ~9–11 turns | 6 | `outcome-missing` (both) |
| Sonnet | single- vs multi-user | 0 of 6 | ✅ 0 errors, ~8 turns | 6 | `outcome-missing` |
| Haiku | reminder delivery channel | 0 of 6 | ✅ 0 errors, ~18 turns | **10** | `outcome-missing` |

`outcome-missing` renders as *"What outcome justifies this system's
existence?"* with materiality *"Without a declared goal or outcome, no
alternative can be selected or rejected on grounds anyone can review;
every later trade-off becomes taste."*

## Findings

1. **The engine's first question is tier-invariant; freehand's is not
   even stable.** Five of five tool runs across three tiers converged on
   `outcome-missing`. Freehand asked zero motivation questions in
   twenty-four attempts at any tier, and its *first* question drifted
   across tiers (delivery channel at Fable and Haiku, user model at
   Sonnet) while being consistent within a tier. Freehand priority is a
   judgment call that moves when the model changes; the engine's is a
   property of the model-plus-catalogue.

2. **The open-question count rose to meet generator weakness.** Fable and
   Sonnet models: 6 open. Haiku: 10 — because Haiku silently dropped the
   stated CRUD/reminder requirements and the Cloudflare constraint, and
   `constraints-missing` fired on exactly that omission. The verifier's
   agenda expanded to cover what the weak generator missed. This is the
   H2 mechanism made visible: detection moved from the generator to the
   deterministic loop.

3. **The weak tier voluntarily used the validated writes — and they
   held.** Haiku built its model through `add`/`connect` (eight calls,
   all first-try); every stronger agent hand-authored YAML. The surface
   that recorded zero use in every strong-tier dogfood is the weak tier's
   bridge, and it structurally cannot emit the YM404s that burned earlier
   first drafts. Cost note: Haiku's full tool run was 38k tokens against
   Sonnet's 73k for the identical next question.

4. **Abstraction quality stayed tier-separated.** Haiku produced a flat
   four-concept model; Fable a requirements-first eight-concept model;
   Sonnet the richest — an `applicationEvent` correctly `triggering` an
   `applicationProcess`, the only agent to use `triggering` rather than
   avoid it. All four dimensions of the decoupling frame appear at once:
   validity flattened (every model green first try), coverage gaps caught
   (finding 2), truthfulness partially caught (Haiku marked unbuilt
   services `status: current`; wiring cannot see existence, so nothing
   fired), and taste still tier-bound.

5. **Friction reproduced across tiers.** All three tool tiers read
   `src/profile.ts` to learn the kind vocabulary (#89). None hit a YM404:
   the v0.5.0 reference guidance (assignment for invocation,
   flow-degradation) steered every agent around the traps that burned
   three of four discovery agents a week earlier — prevention, not
   repair.

## What this does not show

- **No statistics.** n = 1–2 per cell, one stimulus, one catalogue.
- **Not discoverability.** The tool arm was instructed; unprompted
  adoption at the weak tier remains unsolved (sweep finding, unchanged).
- **Not question quality overall.** Freehand's questions were good — the
  reminder-channel question is genuinely load-bearing, and the engine is
  structurally blind to it (it lives in requirement *words*, not wiring).
  Neither arm dominates: the engine under-asks *how*, freehand under-asks
  *why*. The product implication is composition — catalogue drives the
  waves, the model enriches within them — not replacement.
- **Same-family models throughout** (Claude tiers); cross-vendor
  invariance untested.

## Artifacts

### Freehand outputs (complete)

**Fable, run 1** — #1: reminder delivery channel + contact info ("the one
requirement that cannot be built at all as written"). Then: single- vs
multi-user and auth; task fields and recurrence; due = date or datetime
and whose timezone; reminder lead time / re-fire / escalation; scale and
budget.

**Fable, run 2** — #1: reminder delivery channel, arrival when app is
closed. Then: multi-user and auth; reminder semantics (lead time, snooze,
cancel-on-complete); date vs datetime and timezone; task fields, tags,
sharing; scale and budget.

**Sonnet** — #1: single-user personal tool or multi-user with accounts
("every other decision — data model, auth, and who a reminder even gets
sent to — depends on this"). Then: delivery channel; due-date semantics
and timezone; lead time / repeat / escalate; scale and Cloudflare budget;
web UI vs API and brand.

**Haiku** — #1: reminder delivery channel incl. multi-channel priority
("determines the entire infrastructure"). Then: single- vs multi-user and
sharing; task properties; trigger timing; auth mechanism; data residency,
latency, sync, scale.

### Tool-arm models (as authored; each passed `check` first try)

**Haiku** (4 concepts / 4 relationships; via `add`/`connect`): actor
User; dataObject Todo Task; applicationServices Task Management and
Reminder, both wrongly `status: current`; serving ×2 to User, access
read-write and read to the task. Omitted: the stated requirements and the
Cloudflare constraint (caught as finding 2), descriptions (3 subjects
flagged), assignment (flagged).

**Fable, run 1** (8 concepts / 10 relationships; hand-authored;
run 2 near-identical, differing only in ids and one service name):

```yaml
concepts:
  - {id: crud-requirement, kind: requirement}
  - {id: reminder-requirement, kind: requirement}
  - {id: cloudflare-hosting, kind: constraint}
  - {id: user, kind: businessActor}
  - {id: todo-app, kind: applicationComponent, status: planned,
     constraints: [{id: hosting, ref: cloudflare-hosting}]}
  - {id: task-management, kind: applicationService, status: planned}
  - {id: due-reminder, kind: applicationService, status: planned}
  - {id: todo-task, kind: dataObject}
relationships:
  - todo-app -realization-> task-management, due-reminder
  - task-management -realization-> crud-requirement
  - due-reminder -realization-> reminder-requirement
  - task-management, due-reminder -serving-> user
  - user -assignment-> task-management
  - task-management -access(rw)->, due-reminder -access(r)-> todo-task
  - due-reminder -flow-> user (content: reminder)
```

**Sonnet** (7 concepts / 8 relationships; hand-authored; the only run to
model the reminder as behavior):

```yaml
concepts:
  - {id: user, kind: businessActor}
  - {id: cloudflare-platform, kind: constraint}
  - {id: todo-application, kind: applicationComponent, status: planned,
     constraints: [{id: platform, ref: cloudflare-platform}]}
  - {id: todo-task-management, kind: applicationService, status: planned}
  - {id: todo-task, kind: dataObject}
  - {id: todo-task-due, kind: applicationEvent}
  - {id: send-reminder, kind: applicationProcess}
relationships:
  - todo-task-management -serving-> user
  - todo-application -realization-> todo-task-management
  - todo-task-management -access(rw)->, todo-task-due -access(r)-> todo-task
  - todo-task-due -triggering-> send-reminder
  - todo-application -assignment-> todo-task-due, send-reminder
  - send-reminder -flow-> user (content: reminder)
```

### Interrogate outputs (open sets)

- Fable ×2: `outcome-missing`, `stakeholders-missing`, `owner-missing`
  ×3, `states-undefined` — 6 open, 4 questions.
- Sonnet: `outcome-missing`, `stakeholders-missing`, `owner-missing` ×2,
  `actor-unassigned` ×1, `states-undefined` — 6 open, 5 questions.
- Haiku: the above plus `constraints-missing` (the dropped constraint and
  requirements) and `concept-undescribed` ×3 — 10 open, 7 questions.

## Addendum: the combined arm (same day)

The pilot above tested each half alone. The product configuration —
catalogue drives the waves, the model's own judgment enriches within
them — had zero runs. Immediately after `context --brief` shipped
(#88, ADR 0055), one combined-arm run per tier (Sonnet 5, Haiku 4.5):
same stimulus, fresh isolated workdirs, packed CLI, instructed to model
faithfully, get `check` passing, run `interrogate`, then compose a
six-question agenda drawing from **both** the engine's open questions
(quoting materiality) and their own judgment about what the request
wording leaves unspecified — every item labelled `engine:<id>` or
`agent` — closing by rendering the planned component's `--brief`.

| Tier | Rank 1 | Agenda mix | Open items | CLI errors | Brief | Tokens |
| --- | --- | --- | --- | --- | --- | --- |
| Sonnet | **agent: reminder channel** | 3 agent + 3 engine | 6 | 0 | ✅ first try | 67k |
| Haiku | **agent: reminder channel** | 2 agent + 4 engine | **10** | 2 (recovered) | ✅ first try | 44k |

Findings:

1. **No composition collapse at either tier.** The predicted failure
   mode — the weak tier leaning entirely on the engine and contributing
   nothing — did not occur. Haiku contributed two content questions
   (channel; retry/frequency), Sonnet three (channel; single- vs
   multi-user; fire timing/escalation). The engine items appear beneath
   them essentially in wave order, materiality quoted.

2. **Both tiers independently ranked their own channel question above
   `outcome-missing`.** The registered prediction (engine question stays
   Q1) was wrong at both tiers. The honest reading: the engine's agenda
   is a floor, not a ceiling — its contribution is that the motivation
   questions are *present* at every tier (freehand managed this in zero
   of twenty-four attempts), while ranking stays a judgment the agent
   still exercises. The combined agenda is the union the pilot's
   composition finding predicted: freehand's best "how" questions and
   the engine's "why" questions, in one list, at both tiers.

3. **Coverage-expands-to-weakness replicated.** Haiku 10 open vs
   Sonnet 6, and the same silent omissions as the pilot were caught
   (no requirement/constraint concepts, no declared service, statuses
   omitted). Haiku's failure *shifted* — the pilot's false
   `status: current` became omitted status — and the catalogue caught
   both variants. Notably Sonnet also left `constraints-missing` open by
   modelling Cloudflare as a deployment `node` rather than a constraint
   concept; a defensible style the catalogue nudges toward explicitness.

4. **The brief is a taste-inspection surface.** Both rendered first-try,
   and the tier gap is audible in prose without reading YAML: Sonnet's
   brief opens "You are building \"Todo Application\"…" with a coherent
   behaviour chain, while Haiku's reads "\"Todo Application\" *is* an
   application component" (no status declared) and "It flows to
   \"Reminder Service\"" (component-to-component flow). Renderer
   friction noted for later: `assignment` reads as "is assigned to" in
   both directions, which is faithful but stilted for node-hosts-component.

5. **Sonnet articulated the division of labour unprompted** — each of
   its agent-sourced rationales explains *why the structural check
   cannot see the gap* ("the model already compiles cleanly with a
   single unqualified `triggering` edge"). The `flow` vs `serving`
   ambiguity for "sends a reminder" was its only reported friction.

## Relationship to the roadmap

Findings 1–3 are the operational core of the capability-flattening story
(H2) on the cheapest substrate yet measured; finding 4 is the taste
boundary behaving as predicted; finding 5 closes the loop on the YM404
arc and motivates #89. The combined-arm addendum demonstrates the
configuration PR #85's conditions assume: interrogate supplying the
floor, agent judgment the ranking, `--brief` (#88, now shipped) the
outbound artifact. The real experiment — repeats, blinded stimulus
variants, coverage-by-wave scoring — belongs to the elicitation family
in the spec-build design (PR #85), which should treat this document as
its pilot and its protocol template.
