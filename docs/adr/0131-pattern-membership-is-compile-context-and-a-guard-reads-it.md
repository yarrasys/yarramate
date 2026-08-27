# Pattern membership is compile context, and a guard reads it

Status: accepted

A pattern's interview half is most of what a pattern is: "these parts,
related this way" ships as structure, and "here is what you must decide once
you adopt it" had no way to fire (#346, filed by ApertureX). The issue's
re-scope narrowed the gap precisely: instance-level questions already work,
because a pattern is a KIND and an instance carries it in the graph like any
subject. What nothing could see is MEMBERSHIP — which slot of which instance
a subject fills. `parts` binds existing subjects rather than minting them
(#268), the binding is consumed during expansion, and `patternInstances`
never leaves the compile.

Decided, in two halves that keep #268 intact rather than reversing it:

1. **The compiler emits membership as compile context, not as graph
   claims.** A successful compilation now carries
   `patternMemberships: readonly PatternMembership[]` — one entry per bound
   slot: `{ member, slot, instance, pattern }`, where `pattern` is the kind
   identity (`yarrasys/api-led@1.0#api`), the naming ADR 0129 already chose
   for pattern conditions: identity that travels, never a document path.
   The serialized graph does not change by a byte. #268's line — expansion
   produces a graph indistinguishable from a hand-authored one, every
   minted claim `origin: 'declared'` — was a deliberate decision, an author
   cannot write a membership claim, and a graph carrying claims no author
   could write is exactly the distinguishability #268 refused. The
   provenance exists only inside the compile, so the compile result is
   where it surfaces.

2. **A new trigger condition, `fills-pattern-slot`, reads it as a GUARD.**
   Per the guard/remedy split #334 made explicit: the condition says the
   question applies here, and an existing condition beside it says what
   would answer it, so it needs no answer shape of its own. It holds for a
   subject when some membership names it, narrowed by two optional facets:
   `patternKinds` (which pattern, by kind identity) and `slots` (which
   part). Bare, it means "bound into any slot of any pattern instance".
   `evaluateCatalogue` takes the memberships as a sixth optional
   parameter — the published-signature rule that added `catalogues` as a
   fifth applies unchanged — and every CLI verb threads
   `compilation.patternMemberships` through.

**Absent input stays quiet, and that is the recorded house semantics, not a
new choice.** `unchallenged-evidence` already states it: an absent overlay
is "unknown, not absent", the same rule `unconstrained-kind` applies to a
missing profile context. A caller that does not pass memberships gets a
condition that never holds, never one that guesses. The consequence for a
direct API consumer is stated loudly in the docs: pass
`patternMemberships` from the compilation or slot questions never fire.

Referential integrity follows the ADR 0128 line as sharpened by #351:

- A `patternKinds` entry is a KIND REFERENCE and joins the existing YM914
  validation — a mistyped identity is refused when a profile context is
  present, because a condition that can never fire is the silent failure
  this codebase keeps paying for.
- Whether the workspace actually declares a pattern for that kind is NOT
  validated, deliberately: a domain catalogue ships across engagements, and
  an engagement that has not adopted the pattern yet is honest emptiness,
  the same portability ADR 0128 preserved for path-supplied projections.
- A `slots` name is not validated at catalogue load — the catalogue is
  workspace-independent and the slot vocabulary lives in the pattern
  document. Deferred with a gate: teach `check` to compare the two when
  both are manifest-declared in one workspace, when a real mistyped slot
  costs someone a silent interview. The inert-fixture hazard this leaves
  is held by a mutation-verified test instead.

Rejected:

- **Membership as graph claims** (a `yarramate/pattern/fills` predicate or
  a new claim origin). Reverses #268 for the convenience of one consumer,
  changes the published graph every reader validates, and makes the
  expansion distinguishable forever. The compile-context road costs one
  optional field and one optional parameter.
- **`kindMatching: descendants` on `patternKinds`.** No pattern kind
  hierarchy exists in any shipped profile; add the facet when one does.
- **A workspace-scoped variant.** "Any subject fills a slot of pattern X"
  is the instance-level question, which already works through ordinary
  kind scoping — the re-scope proved it with a probe catalogue.
