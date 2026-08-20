# Design: Interaction-first interrogation

Status: **accepted for implementation** (review of 2026-08-20 adopted).

Related:

- Issue [#205](https://github.com/yarrasys/yarramate/issues/205) — integration
  interrogation is dominated by generic model hygiene
- Review:
  `docs/superpowers/specs/2026-08-20-interaction-first-interrogation-design-review.md`
- PR [#204](https://github.com/yarrasys/yarramate/pull/204) — second
  context-benchmark sweep, `yarramate@0.22.0`, 2026-08-19
- Elicitation pilot:
  `docs/research/context-benchmark/ELICITATION-PILOT-2026-07-31.md`
- Spec-build family:
  `docs/research/context-benchmark/spec-build/RESULTS-2026-07-31.md`
- Catalogue contract: ADR 0053, 0058, 0063; `docs/INTERROGATION.md`;
  `docs/AGENT-INTERFACE.md`
- Capture: ADR 0004 (`flow.content`), 0015 (constraints), 0037
  (descriptions are opaque), 0075 (`expects`), 0083 (serving does not pin
  aspect)

This document is the interrogation approach. A maintainer review accepted the
direction and required table-to-engine distance closed before
implementation. Those amendments are folded in; they do not change the
thesis.

---

## Review amendments (2026-08-20)

Locked decisions. Do not re-litigate in implementation PRs.

1. **AND-only triggers.** A question `trigger` is `.every()` with no
   combinator. Every question id has one conjunctive condition set. The
   payload and mechanism rows that needed OR or a conditional closer are
   split (F1).
2. **Post-reification counterparts.** After `hop-unrealised` closes, the
   hop’s serving/flow/triggering counterpart is a behavior or interface,
   not a component. Trust, delivery, capacity, and mechanism use that
   counterpart list (F2).
3. **Applicability.** A question is applicable iff every concept or
   relationship kind it names is contributed by a profile **selected by
   at least one document** (`graph.profiles`), not merely loadable from
   the manifest (F3.1). Inapplicable questions are **omitted** from the
   `ask --open` report and from `summary.questions`. They are not
   `open: false` (quiet-lie) and not `open: true` (forever-trap). No
   `applicable: false` marker in the default report; diagnosis of “why
   didn’t authn fire?” is that the question is absent, which means the
   policy profile is not selected.
4. **`no-subject-of-kind` lineage.** The evaluator must honour the
   schema’s `kindMatching` default `descendants`. This is a trigger
   loosening of four shipped workspace questions (`outcome-missing`,
   `stakeholders-missing`, `constraints-missing`, `no-service-declared`)
   and is changeloged as such (F4).
5. **Shipped policy profile.** Built-in resolution of
   `yarramate/policy@0.1` (catalogue-style), not a vendored copy. Adoption
   is **multi-document, multi-profile**: policy subjects live in a
   document that selects the policy profile; components may stay on an
   existing org profile; hops bind with qualified `constraints[].ref`.
   Re-basing an org profile onto policy is allowed and **not required**.
   Multi-`extends` is out of scope. An ADR distinguishes this from ADR
   0087 (notation is presentation; policy kinds are semantics) (F5,
   composition pushback).
6. **`applicationInteraction`** is a behavior kind on every behavior
   list. `applicationCollaboration` is active-structure. Aggregating
   components into a collaboration does **not** close `hop-unrealised`;
   the selected component still needs assignment to a
   behavior/interface. No aggregation walk (F6).
7. **`has-linkage` / `exists-linkage` support `direction: either`.**
   `missing-linkage` stays `outgoing|incoming` (F7).
8. **Per-hop trust authority is `either`.** Workspace policy-standard
   questions stay `human` (F8).
9. **First-wave stop** is skill-only for 0.9, keyed off the design
   step’s required `wave` field: when `design --json` serves a step
   whose `wave` is not `interaction` for the slice in focus, stop and
   render the brief. No `design --wave` in 0.9.
10. **`reliability-constraint`**, not `delivery-constraint`. Planned 0.2
    kinds `authorization-constraint` and `transport-security-constraint`
    are named in the profile ADR now; they are not in 0.1. Profile local
    ids are kebab-case (`schema/yarramate-profile.schema.json`); Core's
    camelCase kinds are built-in code, not a YAML profile.
11. **`askPlain`** on new questions is an authoring gate enforced by
    slice 3 catalogue tests, not a schema `required` field.

---

## 1. Problem

YarraMate already has a deterministic gap engine. `design` and `ask --open`
evaluate `catalogues/core-enrichment.yaml` (0.8) against the compiled graph
and report what nobody has decided yet. On an API-heavy integration model
that already passes `check`, that engine does not behave like an integration
architect. It behaves like an ontology linter.

Issue #205 reproduced this on a valid 69-concept / 102-relationship estate
(`yarramate@0.22.0`):

```text
yarramate ask .yarramate/workspace.yaml --open --json
# 16 question types, 226 open subject-level instances
```

| Question | Wave | Instances |
|---|---|---:|
| `owner-missing` | business | 45 |
| `kind-untested` | hygiene | 45 |
| `component-unhosted` | technology | 35 |
| `component-realizes-nothing` | application | 34 |
| `planned-design-unattested` | application | 33 |
| **Total** | | **192 / 226 (85%)** |

The model already contained Experience → Process → System chains, proposed
endpoint operations, and event subscriptions. The interview did not ask
mechanism, trust, contract, failure, or capacity on those hops. An owner or
attestation question cannot compensate for a hop whose protocol, trust
boundary, delivery semantics, or failure behaviour is unknown.

`design` serves `owner-missing` **once** with a 45-entry `openSubjects`
roster (issue #116, PR #118), then continues wave order. The complaint is
45 subjects on the agenda before any interaction question, not 45
interviews.

That is the product failure. The rest of this document is what to do about
it without turning Core into an API specification language and without
replacing the shipped interview with a domain wizard.

---

## 2. What this is not blaming

The engine is doing what it was designed to do. The failure is a mismatch
between **what the catalogue asks** and **where an integration model's
load-bearing claims live**.

Verified in this repo:

- Catalogue scope is `subject` (concepts only) or `workspace`.
  `selectSubjects` in `src/interrogate-command.ts` iterates compiled
  concepts. Relationship subjects cannot be questioned.
- Every current trigger is an *absence* (`missing-*`, `isolated`,
  `no-subject-of-kind`, `unconstrained-kind`, …) except `near-duplicate`.
  There is no `has-linkage`. The engine cannot say “this component
  participates in a chain.”
- `serving` does not pin aspect (ADR 0083). Only `assignment`, `access`,
  `triggering`, and `influence` do. An Experience → Process → System estate
  connected only by `serving` is, to `kind-untested`, a pile of untested
  labels — even with 46 API-level relationships.
- `owner-missing` lives in the **business** wave. `design` serves wave
  order, then catalogue order (`src/design-command.ts`).
- Relationships may carry `name`, `description`, `references`, `status`,
  `presentIn`, `mode` (access), and `content` (flow). They may **not**
  carry `owner`, `constraints`, or `attestations`
  (`schema/yarramate-document.schema.json`). Identified `references` are
  citations, not constraint bindings (ADR 0037).
- Descriptions compile to claims and are opaque to Core. A catalogue
  trigger cannot close on words in a description.
- Core has one `constraint` kind and one `requirement` kind. The engine
  cannot tell an authentication constraint from a rate-limit constraint
  unless those answers are **different subjects** (or different kinds).

So: the model *can* record integration decisions, if they are reified as
subjects. The interview *does not ask* for those subjects, and cannot
discriminate their closures today.

---

## 3. Evidence this proposal is required to honour

### 3.1 Elicitation pilot (2026-07-31)

Freehand agents asked load-bearing *how* questions (reminder channel, auth,
timezone) and zero *why* questions. Tool-equipped agents, driven by the
catalogue, all asked `outcome-missing` first, at every tier.

The engine is structurally blind to decisions that live in requirement
words rather than wiring. Combined-arm runs then ranked the agent’s channel
question *above* `outcome-missing` at both Sonnet and Haiku. The recorded
implication: **catalogue is the why-floor; agent judgment supplies how;
neither arm is sufficient.** Composition, not replacement.

The tool-arm models already showed capture vs interview:

- Fable encoded Cloudflare as a `constraint` and the reminder as
  `flow.content: reminder`.
- Sonnet reified the reminder as `applicationEvent` → `applicationProcess`
  → `flow` to the user — the only run that used `triggering`.
- The catalogue treated Fable and Sonnet as equal (six open items, all
  motivation/hygiene). Sonnet’s extra how-structure was invisible to
  interrogation.

### 3.2 Spec-build (2026-07-31)

Designers interrogated until only unanswerable items remained. Three B
models still had 47, 44, and 27 planned concepts for the same spec. A
checked, catalogue-clean model did not beat a good design document on build
convergence. What did show: **every extra truthful claim is a witness
against a lie.** Correlated ownership, access, and description caught
shifted edges. Lies with no redundant claim slipped through.

`catalogue clean` is the wrong stop condition for design-readiness.
Granularity is unconstrained. Enrichment pays off when it adds correlated
structure, not labels.

### 3.3 Second sweep (PR #204, 2026-08-19, `yarramate@0.22.0`)

This is the current number, not the July 29 sweep.

- Gallery models were **deliberately not enriched** for catalogue 0.8.
  Open counts: httpie 43, fastify 55, uptime-kuma 40, miniflux 70, kafka 75,
  keycloak 86. Hygiene dominates CLI-shaped models; kafka/keycloak open
  more application/technology questions **because those subjects already
  exist**. The catalogue asks about structure that is there. It does not
  invent hops.
- **H1:** pooled B−A still underpowered (+9.8 pts). The load-bearing split
  is family: sonnet *change* B is 13/14 vs 8/14 in A. Sonnet
  *comprehension* is flat at 28/32 with or without the model. The model
  earns its keep on later **edits that consult it**, not on multi-hop
  reading.
- **H2:** flattening appears only on the deterministic loop (`check-pass`
  24/24 both tiers; `no-contradicted` B 6/6 both). On change-B the Sonnet–
  Haiku gap *widens* to 50 pts. How-questions without compiler-visible
  homes will not flatten weaker generators.
- **H3:** C ≥ A everywhere. Zero `staleInfluence`. Repair of injected
  contradictions is rare and criterion-driven. Unused models do not
  poison; they are also not consulted, and they are not repaired without
  a gate.
- Catalogue-not-worse (secondary gate, not comparable across sweeps
  because of harness v3 delta 2): haiku 14/20, sonnet 13/20. Within this
  run, when agents edit the model the interview often gets worse. Do not
  quote this as a headline result.

Implications this design takes as binding:

1. Enrichment is for architecture-first design and later change work, not
   for helping agents read kafka/keycloak source.
2. Every accepted answer must be an `apply` that `check` can see.
3. Do not score success as “fewer open questions on the gallery.”
4. Do not grow the current hygiene catalogue against component inventories
   and call that integration architecture.

---

## 4. Thesis

Interrogation should **create interaction subjects that a later edit is
forced to read**, then bind **named, distinct policy subjects** to those
interactions.

It should not:

- rank the existing hygiene questions more cleverly
- stamp protocol/auth/retry fields onto `serving` edges
- offer an “integration architecture” vs “webapp” interrogation mode
- close several NFRs because *some* constraint exists
- treat `ask --open` going quiet as design-readiness

The first wave after motivation asks for hops, mechanism, trust, failure,
and capacity **as separate questions with separate closures**, and only
where hop topology makes them load-bearing. Owner, hosting, attestation,
and `kind-untested` remain in core-enrichment as later hardening.

---

## 5. Goals and non-goals

### Goals

1. On a model of components linked by `serving` / `flow` / `triggering`
   with no assigned behavior, `design` asks for the interaction subject
   **before** `owner-missing`.
2. Security and rate limiting cannot close the same trigger. Each named
   NFR has its own open condition and its own closing claim.
3. Answers land as native subjects and relationships, in one `apply`
   batch, and the next `design` run recomputes closure from the graph
   (ADR 0053 / 0058).
4. A brief of the affected slice names mechanism, payload, and the bound
   policy subjects — so later change work has something to consult (H1).
5. Core remains not-an-API-spec-language. Capture uses existing
   relationship kinds plus constraint bindings on **behavior** subjects.
6. Additive catalogue growth under ADR 0063 (new questions, loosened
   triggers only). No silent change to what an existing “complete”
   interview meant, except the honest reopen of *new* questions and the
   F4 lineage loosening of `no-subject-of-kind`.

### Non-goals (explicit rejections)

- **No interrogation profile / named catalogue switch**
  (`--profile integration-architecture`, `--catalogue` as the default
  agent path, webapp-vs-integration wizard). Profiles in this repo are
  vocabulary (`docs/PROFILES.md`). Catalogues are questions. The agent
  contract says the catalogue is internal and harnesses never pass
  catalogue files (`docs/AGENT-INTERFACE.md`). A domain mode-switch is
  the wrong selector for mixed estates (an integration model has
  Experience APIs; a webapp has system hops). Hop triggers in one
  shipped catalogue are the selector.
- **No materiality scoring** (fan-in, data sensitivity, SLA). Wave order
  is the ranker we already have.
- **No stakeholder question packs** as a product surface. `authority`,
  `askPlain`, and `design --facilitate` already exist. `openSubjects`
  already batches policy-once apply (issue #116, PR #118).
- **No auto-detect “API-heavy” and silently change the interview.**
  Completeness is not Core’s job. Opt-in is vocabulary presence and hop
  topology, not a heuristic over names.
- **No protocol/auth/retry fields on `serving`.** That is the API-spec
  expansion #205 said it did not want.
- **No relationship-scope, path walking, or synthetic flow subjects** in
  the first slice. One-hop `has-linkage` is enough to start.
- **No constraints-on-relationships** in the first slice. Useful later
  as authoring convenience; not required if hops are reified as
  behaviors that already accept `constraints`.
- **No gallery hygiene enrichment** as part of this work. PR #204 left
  those models unenriched on purpose.
- **No “at least one constraint is bound” closer.** That is
  `owner-missing` with different copy. Rate limiting must not silence
  authentication.
- **No `anyOf` trigger combinator.** Split questions instead.
- **No multi-`extends`.** Composition is multi-document (see §6.5).

---

## 6. Capture: where answers live

Native documents have no metadata bag. A fact is defined syntax that
compiles to a claim, or it is a versioned profile kind.

### 6.1 Structure (Core as it stands)

| Decision | Honest home |
|---|---|
| Who participates | `applicationComponent` (already present in the #205 estate) |
| What the hop *is* | `applicationProcess`, `applicationFunction`, `applicationInteraction`, `applicationEvent`, or `applicationInterface` — a **behavior or interface subject**, assigned from the component |
| Sync request vs event vs content transfer | Relationship **kind** between behaviors: `serving`, `triggering`, `flow` |
| What moves | `flow.content` (ADR 0004); `dataObject` / `contract`; `access` with `mode` |
| Runtime | `node` / `systemSoftware` / `path` / `communicationNetwork` (already asked later as `component-unhosted`) |
| Failure path | Additional behavior and `triggering` / `orJunction` as a *resolution hint*; 0.9 closer is a bound `reliability-constraint` |

Invocation between two components is already documented as: name the
behavior, assign the performers, relate behaviors (native authoring;
YM404 if `triggering` is used between active-structure ends). This
design uses that encoding as the interview’s first demand, not as a
workaround.

`applicationCollaboration` is active-structure, not a hop. Assigning a
collaboration to an interaction does not close `hop-unrealised` on the
member components. Those components still need their own assignment to
a behavior or interface. No aggregation walk in 0.9.

The wave id `interaction` sits next to the Core kind
`applicationInteraction`. The wave is interview phase; the kind is a
behavior. Both names stay.

### 6.2 Policy (must be distinguishable)

Core can *store* “OAuth client credentials” and “100 rps per client” as
two `constraint` concepts. Core **cannot tell them apart for a trigger**
while they share one kind.

Distinct NFR questions therefore require distinct closing claims.
Specialized constraint kinds in a conservative-extension profile
(`yarramate/policy@0.1`):

| Kind in 0.1 | Parent | Role |
|---|---|---|
| `authentication-constraint` | `constraint` | How the hop authenticates |
| `rate-limit-constraint` | `constraint` | Capacity / none |
| `reliability-constraint` | `constraint` | Retry, idempotency, dead-letter |
| `mechanism-constraint` | `constraint` | Protocol on a `serving` hop where kind is not enough |

Planned 0.2 (named now, not shipped): `authorization-constraint`,
`transport-security-constraint`.

Rejected alternatives: well-known binding ids, attestation-as-closer,
description prose, Core fields on `serving`.

This is a **vocabulary** profile, not an interrogation profile. Webapps
that call a system API need `authentication-constraint` too. The kinds
are policy topics, not estate types. Put that sentence in the profile’s
docs.

Conservative-extension rules apply (`docs/PROFILES.md`): a profile
nobody **selects** changes nothing. These kinds only add descendants of
`constraint`. They do not restate Core.

Rigidity: omit. Annotating would be a fresh semantic claim.

### 6.3 Binding

Constraints bind to the **behavior** (or interface) subject, via the
existing `constraints[].ref` list, compiling to
`yarramate/constraint/requires` (ADR 0015). Core does not require the
target to be a kind the *referring* document can declare, which is what
makes multi-document adoption work.

Workspace-scope interview turns create the *policy subjects*. Hop-scope
turns bind them (this behavior requires that standard, or an explicit
not-applicable subject).

Not-applicable is a declared constraint of the same kind. Naming
convention: local id `<policy>-not-applicable` (e.g.
`ratelimit-not-applicable`). The description records **why**. Absence
must not mean both “decided no” and “never asked.”

Numeric or provider-backed values belong in `expects` on the **binding**
(ADR 0075), e.g. `constraints: [{id: capacity, ref: …, expects:
{provider: gateway, key: rps-per-client, value: "100"}}]`, not in prose
on the constraint concept. A projection that is to brief those names
must include the policy subjects; `relationships: connected` does not
follow constraint refs.

### 6.4 What we refuse to capture as a first-class closer

Anything that only exists in `description`. Rationale may live there
once the subject exists (MODEL-REVIEW.md). Closure never does.

### 6.5 Adoption of `yarramate/policy@0.1`

A document selects exactly one profile; a profile has exactly one
`extends`. That is not a wall.

A workspace already compiles several documents with several selected
profiles. The adoption path:

1. Policy subjects live in a document whose `profile:` is
   `yarramate/policy@0.1`.
2. Components and processes may stay on the estate’s existing extension
   profile (this repository’s `engine.yaml` is one).
3. Hops bind with a qualified `constraints[].ref` to the policy
   document’s subjects.
4. `missing-constraint` inspects the **target’s** kind.

Re-basing an org profile onto policy is allowed if the estate wants
those kinds in every document. It is not required, and it must not be
the documented default: extending policy would make NFR questions
applicable on every document that uses the org profile (§8.4), which is
a coarser wizard than the domain interrogation profile this design
rejects.

Engine work (slice 2): resolve the identity `yarramate/policy@0.1`
built-in, the way Core and the shipped catalogue resolve. Users do not
copy a YAML file into `profiles/`. Loading the profile in the manifest
without selecting it on a document still changes nothing.

---

## 7. How questions are selected (hop properties, not estate type)

Reject workspace-global “this is an integration architecture.”

The load-bearing unit is the **hop**.

| Hop property | Questions it makes load-bearing |
|---|---|
| Component participates in `serving`/`flow`/`triggering` (either direction) and has no assigned behavior/interface | `hop-unrealised` |
| Behavior is assigned from a component; the hop still needs a serving/triggering/flow | Folded into `hop-unrealised` resolution (a separate question fired on every assigned process with no outgoing hop, including internal ones) |
| Behavior has `serving` and no `mechanism-constraint` | `interaction-protocol-unbound` (policy profile) |
| Behavior has a `flow` with no `content` | `interaction-content-unknown` |
| Behavior participates in a hop and has no access to `dataObject`/`contract` | `interaction-contract-unknown` |
| Behavior participates in a hop and has no `authentication-constraint` | `interaction-trust-unbound` (policy profile) |
| Behavior has `triggering` or `flow` and no `reliability-constraint` | `interaction-reliability-unbound` (policy profile) |
| Behavior serves a `businessActor` and has no `rate-limit-constraint` | `interaction-capacity-unbound` (policy profile) |

A greenfield todo app with one component and a user still gets
motivation questions. It does not get federation, DLQ, or system-API
mTLS questions. A mixed estate gets trust on the Salesforce hop and
rate limit on the Experience hop without anyone classifying the
workspace.

Phase 1 does **not** compare owners or nodes. Trust fires on assigned
behavior that participates in a hop (behavior/interface/component/actor
counterparts). That is slightly broad. Counterpart owner/node
discrimination is a follow-up.

---

## 8. Engine changes

### 8.1 `has-linkage`

Positive mirror of `missing-linkage`, with `direction: either` in
addition to `outgoing` and `incoming`.

```yaml
- condition: has-linkage
  kinds: [yarramate/core@0.1#serving, yarramate/core@0.1#flow, yarramate/core@0.1#triggering]
  direction: either
  counterpartKinds: [yarramate/core@0.1#applicationComponent]
  kindMatching: descendants
```

Open when at least one relationship of those kinds, in that direction
(`either` = incoming or outgoing), has a counterpart of those kinds.
Lineage resolution identical to `missing-linkage`. Subject-scope (needs
a subject id; workspace-scope use `exists-linkage`).

Schema: copy `missing-linkage`, const `has-linkage`, direction enum
includes `either`. Add `"default": "descendants"` on `kindMatching` for
`has-linkage`, `exists-linkage`, `missing-linkage`, and
`missing-constraint` while touching the schema (today the default lives
only in code for `missing-linkage`).

### 8.2 `missing-constraint`

```yaml
- condition: missing-constraint
  kinds: [yarramate/policy@0.1#authentication-constraint]
  kindMatching: descendants
```

Open when the subject has no `yarramate/constraint/requires` claim whose
object’s concept kind matches. Default `kindMatching: descendants`.

This is the discriminator that stops rate limiting from closing
authentication.

### 8.3 `exists-linkage` (workspace)

Same shape as `has-linkage`, evaluated over every non-retired concept.
Open when any concept would satisfy `has-linkage` with those parameters.
Used so policy-subject questions fire once per workspace that has
integration hops.

### 8.4 `missing-flow-content`

`flow.content` lives on the **relationship**, so `missing-claim` on the
behavior cannot see it. Open when the subject is an endpoint of at least
one `flow` relationship that has no `yarramate/flow/content` claim.
Closes when every touching `flow` has `content`, or none exist.

Required to implement `interaction-content-unknown` under AND-only
triggers without selecting relationship subjects.

### 8.5 Applicability (unknown-kind skip)

A question is **not applicable** when any kind in its `subjects.kinds`,
`trigger[].kinds`, or `trigger[].counterpartKinds` has a profile
identity (the `id@version` before `#`) that is **not** in
`graph.profiles` (selected lineage).

Consequences:

- Omitted from the report. Not `open: false` on a subject-scoped
  unknown selector (today’s quiet-lie). Not `open: true` on a
  workspace-scoped `no-subject-of-kind` with unknown kinds (today’s
  forever-trap). Slice 1 tests pin **both** directions.
- `summary.questions` counts applicable questions only.
- Opt-in: select `yarramate/policy@0.1` on at least one document → NFR
  questions become applicable. Do not select it → structure questions
  (Core kinds) still apply; policy-kind questions vanish.
- Conservative-extension: profile **loaded** in the manifest, selected
  by no document → `graph.profiles` does not include it → skip still
  skips → interrogation output byte-identical to core-only.

### 8.6 `no-subject-of-kind` uses `kindMatches`

Replace the exact-string `includes` with `kindMatches` and
`kindMatching` default `descendants`, matching every other kind-aware
condition. Test: a subject whose kind *specializes*
`authentication-constraint` closes `authn-standard-missing` (and, on
Core, a descendant of `goal` closes `outcome-missing`).

This loosens four shipped questions. Changelog it. Existing core-only
fixtures should not flip.

### 8.7 Out of scope for slice 1

Relationship-scope questions, path/chain scope, owner/node comparison,
`{counterparts}` for `has-linkage` (today `near-duplicate` only; `design`
`askPlain` also does not interpolate counterparts — when that lands,
cover both paths), materiality scores, catalogue `extends`, `anyOf`.

---

## 9. Catalogue 0.9

### 9.1 Versioning

`core-enrichment` 0.8 → **0.9**. Minor, additive (ADR 0063): new wave,
new questions, new optional conditions. Existing questions keep their
ids, waves, and triggers. `since: "0.9"` on every new question.

Do **not** move `owner-missing` out of business.

### 9.2 Wave order

```text
motivation
interaction     # NEW — interview phase; not the Core kind applicationInteraction
business        # owner-missing still lives here
application
technology
implementation
hygiene         # kind-untested still lives here
```

Wave order is catalogue data. `design` walks `report.waves` in array
order. No engine change.

### 9.3 First-wave stop

Skill / harness rule, not an engine gate:

When `design --json` returns a step whose `wave` is not `interaction`
for the slice in focus, stop and render the brief. `wave` is already
required on `yarramate/design-step/v1`.

`ask --open` still reports every applicable open question. `design`
without `--subject` will offer `owner-missing` next; the skill must not
drain it as part of hop design-readiness.

No `design --wave` in 0.9. Existing tests reject unknown options; adding
it later is a deliberate CLI-surface change.

### 9.4 Question set

Every row is one AND-only trigger. Policy-kind rows are omitted when
the policy profile is not selected (§8.5).

Behavior kinds (selectors and assignment counterparts):
`applicationProcess`, `applicationFunction`, `applicationInteraction`,
`applicationEvent`, `applicationInterface`.

Hop counterparts after reification: those behavior kinds plus
`applicationComponent`, `applicationInterface`, `businessActor`.

#### Workspace — policy subjects

| id | Intent | Trigger (AND) | Authority |
|---|---|---|---|
| `authn-standard-missing` | Default authentication for interactions | `exists-linkage` serving\|flow\|triggering, either, to component\|interface\|actor **and** `no-subject-of-kind` `authentication-constraint` | human |
| `ratelimit-standard-missing` | Default capacity rule | `exists-linkage` serving, either, to `businessActor` **and** `no-subject-of-kind` `rate-limit-constraint` | human |
| `reliability-standard-missing` | Default retry/idempotency/DLQ rule | `exists-linkage` flow\|triggering, either **and** `no-subject-of-kind` `reliability-constraint` | human |

Closes when at least one subject of that policy kind exists (the
standard, or a not-applicable subject). Materiality for authn must
**not** imply it covers authorization.

No workspace-level mechanism standard. Protocol is hop-local
(`interaction-protocol-unbound`).

#### Subject — reify the hop

Selector: `applicationComponent`, statuses planned|current.

| id | Intent | Trigger (AND) | Authority |
|---|---|---|---|
| `hop-unrealised` | Name the process, function, interaction, event, or interface this component is assigned to for the hop | `has-linkage` serving\|flow\|triggering, either, to component\|interface\|actor **and** `missing-linkage` assignment outgoing to the behavior/interface kinds | either |

Resolution demands a new or existing behavior/interface subject, not
“add realization or delete the component.” Overlap with
`component-realizes-nothing` is acceptable (different wave). Do not
delete the old question in 0.9.

#### Subject — once a behavior exists

Selector: behavior/interface kinds, statuses planned|current.

| id | Intent | Trigger (AND) | Authority |
|---|---|---|---|
| `interaction-protocol-unbound` | Protocol on a serving hop | Policy applicable **and** `has-linkage` serving, either, to hop counterparts **and** `missing-constraint` `mechanism-constraint` | either |
| `interaction-content-unknown` | `flow` with no `content` | `missing-flow-content` | either |
| `interaction-contract-unknown` | Schema/contract access | `has-linkage` serving\|flow\|triggering, either, to hop counterparts **and** `missing-linkage` access to `dataObject`\|`contract` | either |
| `interaction-trust-unbound` | Bind authentication | Policy applicable **and** `has-linkage` serving\|flow\|triggering, either, to hop counterparts **and** `missing-constraint` `authentication-constraint` | either |
| `interaction-reliability-unbound` | Bind retry/idempotency/DLQ | Policy applicable **and** `has-linkage` triggering\|flow, either, to hop counterparts **and** `missing-constraint` `reliability-constraint` | either |
| `interaction-capacity-unbound` | Bind rate limit or none | Policy applicable **and** `has-linkage` serving, either, to `businessActor` **and** `missing-constraint` `rate-limit-constraint` | either |

`interaction-protocol-unbound` never matches event-driven hops (no
serving). `interaction-capacity-unbound` includes an interface that
serves an actor (Experience edge).

0.9 reliability closer is the bound constraint. A failure behavior is
the stronger *resolution hint*, measured in slice 5 before becoming a
closer.

### 9.5 Grouping

Workspace-scope rows *are* the grouping. `openSubjects` batches
subject-scoped leftovers. Do not build a new grouping engine.

### 9.6 Phrasing bar

Each question’s `materiality` names who acts differently if it stays
open. “Security is critical” is not materiality. Authn materiality must
not claim authorization is covered.

Resolution hints name the apply shape. They do not say “write a
paragraph.”

`askPlain` is required on these questions as an **authoring gate**
(slice 3 tests). The schema remains optional (ADR 0072).

### 9.7 #205 coverage

| #205 area | 0.9 | Later | Rejected |
|---|---|---|---|
| Interaction mechanism and protocol | `hop-unrealised` (relationship kind in the resolution), `interaction-protocol-unbound` | | |
| Integration pattern / Exp-Prc-Sys | Partial: reified behaviors and serving chains | Layer labels stay names, not Core kinds | Orchestration vs choreography as workflow completeness (Core exclusion) |
| Security and trust | Authentication (`authn-standard-missing`, `interaction-trust-unbound`) | Authz, transport, identity propagation (policy 0.2 + catalogue 0.10) | Mega-trust question |
| Data and contract | `interaction-content-unknown`, `interaction-contract-unknown` | Versioning, classification, residency as further policy kinds | |
| Failure and delivery | `reliability-standard-missing`, `interaction-reliability-unbound` | Failure behavior as closer if slice 5 says constraint-only briefs do not change edits | Workflow completeness inference |
| Dependency topology | The serving/flow/triggering graph | Path/chain questions | |
| Deployment and connectivity | Unchanged: `component-unhosted` (later wave) | | |
| NFR / operational | Rate limit on Experience hops | Observability, RTO as further policy kinds | |

---

## 10. Loop, skill, and stop condition

```text
design → answer → apply (one batch) → check → design
```

Skill additions (canonical `skills/yarramate-architecture`):

1. After motivation, work the `interaction` wave to quiet on the chain
   in focus (`design --subject` when focusing).
2. Land each answer as subjects and relationships, never as description
   alone.
3. Policy subjects in a policy-profile document; hops bind by qualified
   ref. One apply batch may create and bind.
4. When the served `design --json` step’s `wave` leaves `interaction`,
   render the brief and **stop**. Do not drain `owner-missing`.
5. Never pass a catalogue path.

`--strict` remains evidence-gated and optional.

---

## 11. Why not the alternatives

### 11.1 Domain interrogation profiles

An `integration-architecture` vs `webapp` switch classifies the whole
workspace. Wrong classification omits questions. Kafka and Keycloak in
PR #204 are not one type. Specific questions need specific triggers and
closures, not a wizard. A named catalogue also breaks “catalogue is
internal.”

### 11.2 “At least one constraint”

Rejected. One constraint of any kind is hygiene. Rate limiting must not
silence authentication.

### 11.3 Putting protocol on `serving`

Reify the hop as behavior; bind policy there; let relationship kind
carry coarse mechanism.

### 11.4 Retargeting `component-realizes-nothing` only

That question is in the application wave. `owner-missing` is in
business. Rephrasing does not change wave order.

### 11.5 Growing Core with security kinds

Conservative extension exists for this. Not every workspace should see
NFR questions as applicable. §8.5 skip works only if the kinds are
*not* Core.

### 11.6 Quieter `ask --open` on the gallery

PR #204 left those interviews open on purpose. Not this project.

### 11.7 Re-base org profiles onto policy

Couples interview opt-in to vocabulary parentage. Multi-document
binding is the adoption path (§6.5).

---

## 12. Implementation slices

Each slice independently reviewable. Do not bundle measurement into
slice 1.

### Slice 0 — Capture fixture (no new engine required for `check`)

Regression fixture: Experience → Process → System document-transfer
chain.

- Architecture document, `profile: yarramate/core@0.1`: three API
  components, assigned processes, `flow` with `content`, `contract` /
  `dataObject` with `access`.
- Policy document, selecting the policy profile (fixture-local
  `example/policy@1.0` until slice 2 ships `yarramate/policy@0.1`):
  `authentication-constraint`, `rate-limit-constraint` on the Experience
  process; the same authn plus `ratelimit-not-applicable` on the System
  process.
- `check` passes.
- A brief of the slice names mechanism (flow + content), payload, and
  **both** policy subjects as distinct names. Binding only rate limit
  must not make authn disappear from the brief. The focused projection
  lists the policy subjects explicitly; connected expansion does not
  follow `constraints[].ref`.

This fixture is the oracle later catalogue tests close against. The
not-applicable path is in the fixture so slice 3 does not only test
bind-one-vs-both.

Until slice 2, the fixture profile is `example/policy@1.0` extending
Core with the same kind ids the shipped profile will use locally. Slice
2 switches the policy document to `yarramate/policy@0.1` and deletes
the stand-in if it is then redundant.

### Slice 1 — Engine

- `has-linkage`, `exists-linkage` (`direction: either`),
  `missing-constraint`, `missing-flow-content`
- `kindMatching` default `descendants` on those schema objects and on
  `missing-linkage`
- Applicability skip (§8.5), tests for both unknown-kind directions
- `no-subject-of-kind` lineage (F4), with a derived-kind closure test
- Conservative-extension: loaded-but-unselected profile ⇒
  byte-identical interrogation
- Changelog the `no-subject-of-kind` loosening

No catalogue questions yet. Shipped interview output unchanged except
the lineage loosening on the four workspace questions.

### Slice 2 — Vocabulary profile `yarramate/policy@0.1`

- ADR: semantics vs ADR 0087 notation; versioning additive in 0.x
  mirroring ADR 0063; planned 0.2 kinds listed; naming
  (`yarramate/policy`, webapps need authn too);
  `reliability-constraint`; not-applicable convention; `expects` for
  numeric values; multi-document adoption path
- Built-in resolution of `yarramate/policy@0.1`
- Switch the slice 0 policy document onto it

Built-in resolution stays on this design’s critical path. Do not wait
for a generic “shipped profile platform” if that would stall 0.9 NFR
questions. Scope: resolve this identity the way Core resolves. No
multi-`extends`.

### Slice 3 — Catalogue 0.9

Wave + questions in §9.4. `askPlain` present on every new question
(test). Tests against the slice 0 fixture:

- before reification: `hop-unrealised` open; `design` serves it before
  `owner-missing`
- after reification without policy profile: structure questions close;
  policy questions omitted
- after selecting policy profile without bindings: trust/capacity open
- binding rate limit only: trust still open
- binding both, plus not-applicable on the system hop: interaction wave
  quiet on those subjects
- derived-kind closure of `authn-standard-missing`

Pre-register the slice 5 change-task rubric as a short paragraph before
authoring question copy, so the questions are not fitted to the
measurement.

### Slice 4 — Skill

Interaction wave, apply-as-subjects, stop when served `wave` leaves
`interaction`, never pass catalogue paths. Tests can assert the skill
text names the `wave` field.

### Slice 5 — Measurement (not a merge gate)

Change task on the fixture: unenriched component inventory vs
interaction-wave-complete model. Sonnet change B−A from PR #204 is the
defended comparison class. Pre-register the rubric in slice 3.

Issue #205: this document is the parent; slices 0–4 are children;
domain interrogation profiles stay closed unless 0.9 misfires.

---

## 13. Success criteria

Slices 0–4 are done when:

1. The document-transfer fixture’s brief names mechanism, payload, an
   authentication rule, and a capacity rule as **distinct subjects**,
   including one not-applicable binding.
2. `design` on that workspace, policy profile selected, asks
   `hop-unrealised` (or a workspace policy-subject question) **before**
   `owner-missing`.
3. Binding only a rate-limit constraint does **not** close
   `interaction-trust-unbound`.
4. Applying the answers uses existing Core relationship kinds plus
   policy-profile constraint kinds. No new Core relationship fields.
5. A core-only workspace (no policy profile selected) does not grow
   open questions that mention policy kinds; those questions are
   omitted, not closed.
6. Conservative-extension: policy profile present in the workspace
   manifest but **selected by no document** ⇒ interrogation output
   byte-identical to core-only. Applicability uses `graph.profiles`.
7. Catalogue bump is 0.8 → 0.9 with `since: "0.9"` on new questions
   only.
8. `no-subject-of-kind` descendant matching is tested on a derived
   kind.

Follow-up (slice 5), not a merge gate:

9. A bounded implementer edit against the enriched slice outperforms
   the unenriched inventory on the pre-registered rubric, at least at
   Sonnet, in the change-family sense of PR #204.

---

## 14. Risks

| Risk | Why it is real | Mitigation |
|---|---|---|
| `hop-unrealised` instance explosion | 27 APIs ⇒ 27 subjects | `openSubjects` + one apply batch; skill does not interview N times |
| Overlap with `component-realizes-nothing` | Same subjects, later wave | Accept in 0.9 |
| Policy profile described as “the integration profile” | Naming drift | `yarramate/policy`; docs; hop triggers remain the selector |
| `exists-linkage` on trivial models | Two-component demo | Workspace NFR questions behind policy profile |
| Collaboration models never close `hop-unrealised` | No aggregation walk | Documented modeling rule: assign the component |
| First-wave stop ignored | Skill-only | Count `design --json` wave in dogfood before considering `--wave` |
| Shipped-profile resolution stalls NFR questions | F5 surface area | Keep built-in resolution on this design’s critical path, scoped to one identity |
| F4 flips existing interviews | Specialized motivation kinds | Changelog; core-only fixtures pinned |
| Haiku will not reify hops | H2 | Verifier flattens validity; do not claim flattening of architect judgment |

---

## 15. Locked answers (reviewer questions)

1. **Policy kinds: optional profile, not Core.** Conditional on slice 2
   built-in resolution, multi-document adoption, and the ADR vs 0087.
   Without those, option A becomes “copy this file,” which was rejected.
2. **Authentication-only for first-wave trust.** Authz / transport in
   0.10 + policy 0.2. Name those kinds in the profile ADR now. Authn
   materiality must not imply authorization is done.
3. **Constraint is the 0.9 reliability closer.** Failure behavior stays
   a resolution hint. Slice 5 decides whether that is enough.
4. **Skill-only stop**, keyed off `design-step.wave`. `--wave` later if
   dogfood shows agents drain ownership anyway.
5. **`hop-unrealised` selects components**, not relationship subjects.
   Relationship-scope is a later issue when a concrete question cannot
   be phrased on the component.
6. **Naming:** `yarramate/policy@0.1`; wave id `interaction` with the
   Core-kind collision acknowledged; `reliability-constraint` not
   `delivery-constraint`.

---

## 16. Suggested issue split

| Issue | Content |
|---|---|
| #205 (reframe) | Parent: diagnosis stands; this document is the direction; domain interrogation profiles are not the direction |
| Child: capture fixture | Slice 0 |
| Child: linkage/constraint conditions | Slice 1 |
| Child: policy profile + built-in resolution + ADR | Slice 2 |
| Child: core-enrichment 0.9 | Slice 3 |
| Child: skill first-wave stop | Slice 4 |
| Later: change-family measurement | Slice 5 |
| Later: owner/node counterpart conditions | Trust-trigger tightening |
| Later: relationship-scope questions | If hop-as-edge is needed |
| Later: constraints on relationships | Authoring convenience |
| Not unless 0.9 misfires | Named integration vs webapp catalogues |
