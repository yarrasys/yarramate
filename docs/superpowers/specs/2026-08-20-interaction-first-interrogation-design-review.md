# Review: Interaction-first interrogation

Target: `docs/superpowers/specs/2026-08-20-interaction-first-interrogation-design.md`
Reviewer role: maintainer, principal-engineer pass
Date: 2026-08-20
Method: every checkable claim in the spec was verified against the working tree
(`yarramate@0.22.0`, `main`), the PR #204 branch, and issue #205. Findings cite
file and line.

## Verdict

**Direction accepted. Request changes.**

The diagnosis is right, the evidence sections are faithful to their sources, and
the thesis (reify hops, bind named policy subjects, hop-property triggers instead
of an estate classifier) is the correct answer to #205 and consistent with ADR
0053/0058/0063 and the conservative-extension contract. The alternatives analysis
in §11 is genuinely load-bearing, not decoration.

Five things must change before this is accepted, none of which threaten the
thesis:

1. Two §9.4 questions cannot be expressed under the engine's AND-only trigger
   semantics and must be split (F1).
2. `interaction-trust-unbound` as drafted does not fire on the spec's own
   recommended encoding (F2).
3. §8.4 (unknown-kind skip) needs a precise applicability definition and a
   report-contract decision; today's engine behaviour differs by scope and one
   half of it is a live bug the slice must fix (F3, F4).
4. Slice 2 is not "ship a YAML file": `yarramate/policy@0.1` would be the first
   shipped optional profile ever, there is no resolution mechanism for shipped
   profiles, and single-`profile:`-per-document plus single-`extends` chaining
   makes adoption impossible for estates already on their own extension profile
   (F5).
5. The behavior kind lists omit `applicationInteraction` and
   `applicationCollaboration`, so the ArchiMate-idiomatic reification of a
   two-component interaction would not close `hop-unrealised` (F6).

Answers to the six §15 reviewer questions are at the end, as requested, instead
of "looks good."

---

## Fact check

The spec invites reviewers to attack its decisions. Its factual ground was
checked first; it is in unusually good shape. Corrections follow the table.

| Spec claim | Verdict |
|---|---|
| §1 numbers (16 types, 226 instances, 85% in five hygiene questions) | Confirmed against issue #205 body |
| §2 catalogue scope is subject/workspace; `selectSubjects` iterates concepts only; relationship subjects cannot be questioned | Confirmed (`src/interrogate-command.ts:278-296`, concepts built at `:202-210`) |
| §2 all ten condition types are absences except `near-duplicate`; no `has-linkage` / `exists-linkage` / `missing-constraint` exists | Confirmed (schema `condition` oneOf; evaluator switch `src/interrogate-command.ts:324-448`) |
| §2 `serving` pins no aspect; only assignment/access/triggering/influence do | Confirmed (ADR 0083; `src/profile.ts:204-233`, `serving` at `:211` declares none) |
| §2 wave placements (`owner-missing` business, `kind-untested` hygiene, etc.) | Confirmed, all five (`catalogues/core-enrichment.yaml:364`, `:1079`, `:722`, `:592`, `:695`) |
| §2 relationships carry description/references/status/mode/content and not owner/constraints/attestations | Confirmed; also allowed: `name`, `presentIn` (`schema/yarramate-document.schema.json:237-287`, `additionalProperties: false`) |
| §2 one `constraint`, one `requirement` kind in Core | Confirmed (`src/profile.ts:79-80`) |
| §3.1 / §3.2 summaries of the elicitation pilot and spec-build results | Fair compressions of both source docs; the "combined-arm ranked channel above `outcome-missing`" point is from the pilot's same-day addendum, correctly so |
| §3.3 sweep numbers (gallery opens 43/55/40/70/75/86; B−A +9.8; sonnet change 13/14 vs 8/14; comprehension flat 28/32; check-pass 24/24; no-contradicted B 6/6; change-B gap +50; zero staleInfluence; not-worse 14/20 and 13/20) | All confirmed against `RESULTS-2026-08-19.md` on the PR #204 branch |
| §9.1 `since` field exists, additive-minor is the ADR 0063 rule | Confirmed (`schema/yarramate-question-catalogue.schema.json:426-431`; all 40 shipped questions declare `since`) |
| §9.2 wave insertion needs no engine work | Confirmed, and stronger than the spec states: wave order is pure catalogue data ("The wave taxonomy is catalogue opinion, not engine semantics", schema `:47`; `design` top-step loop at `src/design-command.ts:65-76` walks `report.waves` in array order). No test pins catalogue `0.8`, question counts, or wave counts |
| §9.3 `design --wave` does not exist | Confirmed; note two tests actively assert unknown options are rejected (`test/design-command.test.ts:334-341`, `test/ask-command.test.ts:506-511`), so adding it later is a deliberate CLI-surface change, which is fine |
| §10 catalogue is internal | Confirmed verbatim (`docs/AGENT-INTERFACE.md:44-49`) |
| Success criterion 6 shape (loaded-but-unselected profile changes nothing) | Confirmed as an existing test pattern (`test/conservative-extension.test.ts:168-190`, `:300-352`) |

Corrections and nuances, none fatal:

- **§2 "It will ask ownership 45 times."** Rhetorical overreach: `design`
  serves `owner-missing` once with a 45-entry `openSubjects` roster
  (`src/design-command.ts:117-122`). The wave-order complaint stands; the
  "45 times" framing does not. Say "45 subjects before any interaction
  question" instead.
- **§3.3 "about a third of the time the interview gets worse."** The
  catalogue-not-worse gate is secondary, not a hard gate, and the sweep doc
  itself marks it non-comparable across sweeps (harness v3 delta 2). The
  within-run reading the spec uses is legitimate; the sentence should carry the
  "secondary gate" qualifier so it is not quoted later as a headline result.
- **§5 non-goals cite #116 for `openSubjects`.** The code comment agrees
  (`src/design-command.ts:119`), but the merge was PR #118 ("One answer, many
  subjects"). Cite issue #116 / PR #118 if precision matters.
- **§8.1 "`kindMatching: descendants` # default, same as `missing-linkage`".**
  The schema declares no default on `missing-linkage` (nor
  `missing-relationship`); the default lives only in code
  (`src/interrogate-command.ts:373`). If `has-linkage` copies that schema
  object, add the explicit `"default": "descendants"` to both while there.
- **§6.2 typo:** "They do not restated Core."
- **§9.6 `askPlain` "required".** Schema-optional by design (ADR 0072;
  absent from the `required` list). Only 20 of 40 shipped questions author it.
  Requiring it on the new questions is an authoring gate for slice 3, not a
  schema property; state it that way, and enforce it in the slice 3 catalogue
  tests so it does not erode.

---

## Findings

Ordered by severity. F1 through F5 block acceptance; F6 blocks slice 3 as
drafted; the rest are advisory.

### F1 (blocking): trigger arrays are AND-only; two questions cannot be expressed as drafted

A question's `trigger` is an array of conditions evaluated with `.every()`
(`src/interrogate-command.ts:516`); the schema is `array of condition, minItems
1` with no combinator. Two §9.4 rows need OR or conditional logic:

- **`interaction-payload-unknown`**: "`has-linkage` flow *or* the subject is a
  process/function with `missing-linkage` access". A cross-condition OR. Not
  expressible. Split into two questions (`interaction-content-unknown` for
  flow-bearing behaviors, `interaction-contract-unknown` for process/function
  without data access), or add an `anyOf` combinator to the engine, which
  contradicts §8.5's "no other engine work". Recommendation: split. Two precise
  questions also satisfy ADR 0063's selector-precision rule better than one
  clever one.
- **`interaction-mechanism-unknown`**: the close column embeds a conditional
  ("if still only `serving` to a component, `missing-constraint
  mechanismConstraint` remains open"). One trigger cannot express "closed
  unless the chosen kind was serving". Split the protocol overlay into its own
  question (`interaction-protocol-unbound`: `has-linkage` serving to a
  component AND `missing-constraint` `mechanismConstraint`), which also cleanly
  resolves the spec's own worry about not demanding `mechanismConstraint` on
  event-driven hops: the trigger simply never matches them.

The spec already flags mechanism as "needs careful trigger drafting". It is not
a drafting nicety; under AND-only semantics the current §9.4 table is not
implementable. Redraft §9.4 with one condition-set per question id.

### F2 (blocking): `interaction-trust-unbound` does not fire on the spec's own encoding

§6.1 and the native-authoring skill define the idiomatic hop as behavior
related to **behavior** (name the invoked behavior, assign the performers,
relate behaviors). But the trust trigger reads "`has-linkage`
serving/flow/triggering to `applicationComponent` OR to `businessActor`".

After correct reification, the counterpart of the behavior's serving/flow edge
is another behavior or interface, not a component. A fully reified chain,
exactly what `hop-unrealised` just demanded, would make the trust question
never open. The mechanism row gets this right ("to a behavior, component,
interface, or actor"); trust and delivery must use the same counterpart list.
Add the behavior and interface kinds to `counterpartKinds` on
`interaction-trust-unbound` (and check `interaction-delivery-unbound` and
`interaction-capacity-unbound` for the same slip; capacity's serving-to-actor
is plausibly fine as drafted, but an interface serving the actor on the
Experience edge should also count).

The slice 0 fixture would have caught this, which is an argument for building
slice 0 first exactly as the spec orders it. Fix the table anyway; the fixture
is the oracle, not the editor.

### F3 (blocking): §8.4 needs a contract, not a behaviour sketch

Three gaps:

1. **"In the workspace's resolved profile lineage" is ambiguous.** Success
   criterion 6 (profile present in the manifest, selected by no document,
   byte-identical output) is only satisfiable if applicability means "the kind
   is contributed by a profile **selected by at least one document**", not
   "loadable from the manifest". PROFILES.md's "a vocabulary nobody selects
   changes nothing" forces the strict reading. Write it down; the two readings
   diverge exactly on the conservative-extension test.
2. **Not-applicable is a third state and the report contract has two.** Today a
   question is `open: true|false`. The spec says a skipped question "does not
   open, does not count in progress, does not appear in `ask --open`". Decide
   how that renders in the `ask` report JSON: absent entirely, or present with
   an explicit `applicable: false`. Absent is simpler but makes "why is the
   authn question not being asked?" undiagnosable; an explicit marker is more
   honest and matches ADR 0063's spirit (honest reopen implies honest
   not-asked). Either way it is an additive report-schema change and the spec
   should name it as slice 1 surface.
3. **Current behaviour differs by scope and the spec describes neither.**
   Verified: a subject-scoped question whose selector kinds are unknown
   silently reports `open: false` (`src/interrogate-command.ts:533-535`), i.e.
   reads as *complete*, which is the quiet-lie variant of the trap; a
   workspace-scoped `no-subject-of-kind` with unknown kinds stays `open: true`
   forever, the trap §8.4 describes. The spec's fix covers both, but the tests
   in slice 1 must pin both directions, not just the open-forever one.

### F4 (blocking): fix the `no-subject-of-kind` lineage bug inside slice 1

Verified live bug, pre-existing: the schema promises `kindMatching` with
default `descendants` on `no-subject-of-kind`
(`schema/yarramate-question-catalogue.schema.json:233-238`), but the evaluator
does a flat exact-string `includes` and never consults lineage
(`src/interrogate-command.ts:363-366`). Every other kind-aware condition routes
through `kindMatches` with `profileContext`.

This matters to this design specifically: all three workspace policy questions
are built on `no-subject-of-kind` over policy kinds. The moment anyone ships a
profile specializing `authenticationConstraint` (an org profile with
`oauthClientCredentialsConstraint`, say), the standard question reopens forever
on a workspace that has answered it. The existing conservative-extension tests
do not catch this because their fixtures keep core kinds on core subjects.
Slice 1 already touches this switch statement; fix the bug there, with a test
where the only matching subject carries a derived kind.

### F5 (blocking): slice 2 understates what "shipped next to Core" means

Verified: there is **no precedent**. No optional profile ships today
(`package.json` `files` has no profiles directory; the only profile in the repo
is the dogfooding `.yarramate/profiles/yarramate-development.yaml`). Core
itself is built-in code (`src/profile.ts`), not a shipped file. And ADR 0087
explicitly rejected the nearest prior candidate (ArchiMate as a profile),
ruling notation is a rendering mode.

Three consequences the spec must address:

1. **Resolution.** Workspaces reference profiles by manifest glob
   (`profiles: [profiles/*.yaml]`); documents select one by id
   (`profile: yarramate/development@1.0`). There is no path from
   `profile: yarramate/policy@0.1` in a document to a file the user never
   copied. Either the engine resolves shipped profile ids built-in (the way
   Core resolves, and the way the catalogue is "internal"), or `init` /docs
   tell users to vendor the file. Built-in resolution is the right call and
   matches the catalogue precedent, but it is engine work that slice 2
   currently does not contain.
2. **Composition.** A document selects exactly one profile and a profile has
   exactly one `extends`. An estate already on its own extension profile (this
   repo's own `engine.yaml` is one) cannot adopt policy without re-basing its
   profile chain onto `yarramate/policy@0.1`. That is a real adoption wall for
   precisely the enterprise estates #205 comes from. Options: multi-`extends`,
   multi-profile selection per document, or explicitly accept chaining and
   document the re-base as the adoption path. The spec must pick one; my
   preference is to accept chaining for 0.1 and say so in the profile's docs,
   because multi-extends drags in diamond-resolution semantics nobody has
   asked for yet.
3. **ADR.** "First shipped optional profile" is an architectural decision with
   an existing contrary-adjacent ADR (0087). Write the ADR that distinguishes
   them: notation is presentation, policy kinds are semantics, which is
   exactly what profiles are for. Also state the profile's own versioning
   rule (additive within 0.x mirrors ADR 0063, so catalogue 0.10 can rely on
   policy 0.2 kinds; §8.4 then degrades gracefully for workspaces on 0.1,
   which is a genuine strength of the skip mechanism and worth stating).

### F6 (blocking for slice 3): the behavior kind lists omit `applicationInteraction` and `applicationCollaboration`

Core has both (`src/profile.ts:116,121`). ArchiMate's idiomatic answer to
"collective behavior of two components interacting" is `applicationInteraction`
assigned from an `applicationCollaboration`. A modeler who reifies a hop that
way satisfies the spirit of `hop-unrealised` and fails its close condition
(assignment to process|function|event|interface). Under ADR 0063's
selector-precision rule that is a catalogue defect on day one. Add
`applicationInteraction` to every behavior list in §6.1 and §9.4 (selectors and
closers), and decide whether collaboration-assigned counts for the assignment
check.

Related, cosmetic: the wave id `interaction` sits next to a Core kind named
`applicationInteraction` that the spec never mentions. Fine to keep the name;
mention the kind so the omission reads as a decision rather than an oversight.

### F7 (should-fix): `has-linkage` needs `direction: either`, or an explicit sink waiver

`missing-linkage`'s `direction` is `outgoing|incoming` only. §8.1 copies it.
"Participates in an interaction" is direction-agnostic: a pure sink (a
component that only *receives* `flow` or `triggering`, e.g. an audit store fed
by events) has no outgoing edge and would dodge `hop-unrealised`. Serving
chains mostly survive because `serving` points outward from every layer, but
flow/triggering sinks are real in the #205 estate class. Since `has-linkage`
is a new condition, supporting `either` at birth costs one `some()` over both
directions; the alternative under AND-only triggers is two near-duplicate
questions. Add `either` to `has-linkage` (and `exists-linkage`) only; leave
`missing-linkage` untouched.

### F8 (should-fix): per-hop trust authority

The workspace standard question is rightly `human`. Per-hop
`interaction-trust-unbound` is also `human`, which means an estate with 20
reified behaviors queues 20 human-authority steps. Once a workspace standard
exists, binding it to a hop is exactly the kind of proposal an agent can make
and a human can veto: `either` with resolution hints that name the standard is
the better default, and it is consistent with `authority` being "a label,
never a gate" (ADR 0082). Keep `human` only for the workspace-level standard
questions.

### F9 (advisory): smaller items

- **Design step already carries its wave.** `wave` is a required field on the
  design-step schema. The §9.3/§10 skill stop-rule can therefore be
  mechanical, not vibes: "when `design --json` returns a step whose `wave` is
  not `interaction` (for the subjects in play), stop and render the brief."
  Cite this in §9.3; it is most of the answer to reviewer question 4.
- **ADR 0075 `expects` is an unused asset here.** Constraint subjects can
  carry `expects` (provider/key/value) compiling to
  `yarramate/constraint/expects`. "100 rps per client" as
  `expects: {provider: gateway, key: rps-per-client, value: "100"}` makes the
  rate-limit subject machine-readable for later evidence work with zero new
  surface. Not required for 0.9; worth one line in the profile docs so authors
  do not bury the number in prose, which §6.4 otherwise invites.
- **Not-applicable constraints: accept, with a convention.** A constraint
  subject asserting "no rate limit, and why" is an ontological wart, but the
  alternative (absence means both "decided no" and "never asked") is the exact
  ambiguity this design exists to kill. Document a naming convention
  (`<policy>-not-applicable` local ids) and require the *why* in the
  description; consider whether the slice 0 fixture should bind one
  not-applicable constraint so the closure path is exercised, since slice 3's
  test matrix currently only covers bind-one-vs-both.
- **`{counterparts}` caveat.** It is computed only for `near-duplicate`
  triggers, and `design` renders `askPlain` without counterparts, so §8.5's
  "later improvement" note should also cover the `askPlain` path when it
  lands.
- **#205 coverage map.** The issue asks for eight areas and recommends the
  profile mechanism this spec rejects. Add a short table mapping the eight
  areas to covered-in-0.9 / deferred-with-a-home (authz, transport, topology,
  deployment) / rejected-with-reason (orchestration-vs-choreography as
  workflow completeness, Core exclusion). The reframe in §16 will land far
  better with the issue author if the spec shows their list was processed
  rather than replaced.

---

## Answers to §15

**1. Policy kinds: optional profile (option A) or Core?** Profile, as
proposed. Core kinds are lineage roots and every kind added to Core makes every
workspace's `kind-untested` and future selectors heavier; conservative
extension exists for exactly this shape; and §8.4 makes the questions skippable
only if the kinds are *not* Core. The counter-case ("every workspace should see
these questions") fails on the spec's own todo-app test. But option A is
accepted **conditional on F5**: resolution mechanism, composition story, and
the ADR reconciling with 0087. Without those, option A quietly becomes option
B'-shaped advice ("copy this file into your workspace"), which is the
brittleness option B was rejected for.

**2. Authentication-only for first-wave trust?** Yes. A mega-trust question
violates the distinct-closure thesis that justifies this whole design, and
authz/mTLS/identity-propagation have a proven additive path (0.10 questions +
policy 0.2 kinds, gracefully skipped by older workspaces per §8.4). Two
conditions: name `authorizationConstraint` and `transportSecurityConstraint`
as planned kinds in the profile ADR now, so 0.2 is anticipated rather than
renegotiated; and make sure the authn question's materiality text does not
imply it covers authorization, or the quiet interaction wave will be read as
"security is done".

**3. Constraint as the delivery/failure closer?** Yes, for 0.9. Requiring a
failure behavior would smuggle workflow-completeness judgment into Core, which
is an explicit exclusion, and H2's lesson is that the closer must be
compiler-visible, which a bound constraint is. Keep the failure behavior as
the *resolution hint's* stronger option, and let slice 5 tell us whether
constraint-only closure produces briefs that change implementer edits. If it
does not, that is evidence for the stronger closer in 0.10, measured rather
than argued.

**4. Skill-only stop vs `design --wave`?** Skill-only for 0.9, strengthened:
the design step already carries `wave` (required in the step schema), so write
the skill rule against that field, i.e. "stop when the served step's wave
leaves `interaction` for the slice in focus". That is checkable in the slice 4
skill tests and in dogfood transcripts, which converts the §14 risk ("agents
will keep going") into something you can count before deciding whether
`--wave` earns CLI surface. Note two existing tests assert unknown-option
rejection, so `--wave` later is a deliberate, testable addition, not drift.

**5. `hop-unrealised` on components or relationship subjects?** Components,
for slice 1. Relationship-scope is the better noun and the worse first slice:
it opens catalogue scope, selection, and identity questions (`selectSubjects`
iterates concepts by construction) that F1 through F5 do not need. The
component phrasing plus `openSubjects` batching covers the #205 estate. Ship
it; revisit relationship-scope when the "Later: relationship-scope questions"
issue has a concrete question that component phrasing cannot carry. It is not
blocking.

**6. Naming.** `yarramate/policy@0.1` is right, and the spec's own argument
(webapps need `authenticationConstraint` too) is the correct defence against
the "integration profile" drift named in §14; put that sentence in the
profile's docs, not just this spec. Wave id `interaction` is acceptable;
acknowledge the `applicationInteraction` kind collision (F6) in the doc.
`deliveryConstraint` is the one id worth a second look: "delivery" reads
postal/logistics in enterprise rooms; `reliabilityConstraint` or keeping
delivery-retry-idempotency in the *name* of the created subjects may age
better. Not a blocker.

---

## Slices and success criteria

The slice cut is right, slice 0 especially: an oracle fixture before any
engine work is what would have caught F2 mechanically. Adjustments:

- **Slice 1** grows three items: the `no-subject-of-kind` lineage fix (F4),
  the not-applicable report contract (F3), and `direction: either` on the new
  conditions (F7). All are inside files slice 1 already touches.
- **Slice 2** needs the shipped-profile resolution decision and ADR (F5)
  *before* implementation; consider splitting "shipped-profile mechanism" out
  as its own reviewable slice, since it outlives this design.
- **Slice 3** redrafts §9.4 per F1/F2/F6 before authoring. Add two test rows
  to the matrix: derived-kind closure (a subject of a kind *specializing*
  `authenticationConstraint` closes the standard question, pinning F4) and
  the not-applicable binding path.
- **Slice 5** is correctly excluded from the merge gate. Keep it honest by
  pre-registering the change-task rubric before slice 3 lands, so the
  questions are not unconsciously authored to the measurement.
- **Success criterion 6** should state the strict applicability definition
  from F3.1, since it is the criterion that forces it.

## Closing

This is the strongest spec this repo has produced: it argues from evidence it
did not cherry-pick (the not-worse and H2 negatives are load-bearing, not
buried), it rejects the issue author's own preferred mechanism with reasons
that survive scrutiny, and nearly every verifiable claim in it checked out
against the code. The blocking findings are all of one family: the distance
between a design table and an implementable catalogue under the engine's real
semantics. Close that distance (F1 through F6), and slices 0 through 4 have my
approval to proceed.
