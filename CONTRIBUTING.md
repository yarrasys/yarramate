# Contributing to YarraMate

YarraMate welcomes focused issues, design discussion, documentation
improvements, fixtures, and implementation changes.

## Issues are welcome

Open a [GitHub Issue](https://github.com/yarrasys/yarramate/issues/new) for:

- bugs and unexpected behaviour;
- confusing diagnostics, commands, or documentation;
- adoption friction and missing examples;
- feature requests and possible improvements;
- questions that may reveal a product or documentation gap.

Anyone may raise an issue, including an agent working in a consuming
repository. A complete design, reproduction repository, or proposed fix is
helpful when available but never required. Describe what happened or what
would be useful in whatever level of detail you have.

Security vulnerabilities are the exception: report those privately according
to `SECURITY.md`.

Issues are feedback and discussion. Any contribution that changes repository
content—code, schemas, documentation, tests, skills, or native models—must be
submitted through a pull request.

An Issue is not required before every pull request:

- small documentation fixes, tests, and clear self-contained bug fixes may go
  directly to a pull request;
- new features and changes to native semantics, schemas, graph interchange,
  diagnostics, stable CLI behaviour, or adapter boundaries should be discussed
  in an Issue before implementation.

When an Issue already exists, link it from the pull request.

## Start with the product contract

Read these sources before changing semantics:

- `docs/PRODUCT-CONTRACT.md`
- `docs/MODEL-FLOOR.md`
- `docs/GLOSSARY.md`
- `docs/ROADMAP.md`
- the relevant decision records under `docs/adr/`

`docs/PRODUCT-CONTRACT.md` and ADR 0002 are authoritative when documents
disagree. Native YarraMate documents are canonical; adapters must not define
Core semantics.

## Development

YarraMate requires Node.js 22 or newer and uses the package-manager version
declared in `package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run verify
```

Use test-driven development for compiler and validation behaviour. New
diagnostics should be deterministic and source-located. Keep adapter-specific
fields outside Core documents and preserve canonical output ordering.

**A `Test timed out` with no assertion failure is probably not your change**
(#458). `pnpm verify` used to fail intermittently on a busy machine with exactly
that and nothing else — no assertion, no diff — which reads like a regression in
whatever you had just touched. It cost real time: a stash-and-reverify cycle to
establish a change was *not* at fault, and re-runs to decide whether a release
was safe to tag.

The cause was the timeout, not the tests. Vitest's 5000ms default sat *below*
this suite's own top end: unloaded, the slowest test takes **9159ms** and eight
are over 2000ms, because the heaviest ones compile the whole repository
self-model or read the built browser bundles. `testTimeout` is now 30s.

Two things that looked true and were not, recorded because they are the shape of
the mistake rather than facts about these ten files. It was first read as worker
contention over `git` subprocesses, since the files that shell out break first —
but push the load higher and plain in-process tests time out too, so it is
starvation, not contention. And a per-file rule keyed on *does this file spawn*
was built and then thrown away, because the slowest test in the suite does not
spawn and the rule would have exempted everything except it.

## Proposing semantic changes

A semantic change should begin with a GitHub Issue so its intended contract can
be discussed before implementation.

A change to native meaning, identity, graph interchange, validation behaviour,
or a stable CLI contract needs:

1. original semantic wording and provenance;
2. an accepted ADR;
3. normative schema or contract changes where applicable;
4. valid and invalid fixtures;
5. deterministic tests and updated documentation.

Do not reproduce restricted definitions, matrices, diagrams, or derivation
rules from external standards. Compatibility work must establish its own
licensing and provenance boundary first.

## Reviewing model growth

`check` decides correctness, `reconcile` reports drift, and `ask --open`
reports which questions are still open. None of them decides whether a new
distinction is worth the contract surface it costs. `docs/MODEL-REVIEW.md`
carries the questions a reviewer puts to the author of a new concept kind,
profile kind, or catalogue question. It is judgment support rather than a
gate, and it applies to a proposal that widens the vocabulary here as much as
to a model in a consuming repository.

## Pull requests

All repository changes are contributed through pull requests. Do not push
changes directly to the default branch.

Keep changes narrowly scoped and explain:

- the problem and intended contract;
- tests and validation performed;
- any compatibility or migration effect;
- whether generated output changed.

### Readers and constructors are not the same consumer

When assessing the compatibility effect of a change to a **projected type** —
anything a consumer receives from this package and may also build, such as
`CanvasNode` on `yarramate/visual-graph/v1` — ask about both directions,
because they do not pay the same price:

- **Reading is unaffected** by a new field. Existing code goes on reading the
  fields it already knew about.
- **Constructing breaks** on a *required* field, at typecheck rather than at
  runtime, in every object literal that builds one. Test fixtures are the
  usual constructors, so the break often lands in a consumer's test suite,
  which is where it is most confusing and least expected.

**They are not the only constructors, and the exceptions are the ones that
matter.** A type a consumer must *build* to satisfy an API of ours is
guaranteed to have constructors in production code: `ResolvedWorkspace` is
built by every embedder of the mounted editor, because ADR 0100 has the
embedder resolve its own manifest. When it gained a required `patterns`, a
consuming product's manifest module broke — not its fixtures. Ask which of
your types a consumer has to construct in order to call you, and treat those
as the sharp ones.

"Consumers reading the graph see no change" is a true sentence that has
misled someone by the time they read it in a red build. Say which direction
you mean, and say it in the changelog entry rather than leaving it to be
rediscovered.

This is recorded because it was learned the hard way: `portKinds` (#268 phase
3) was described as costing readers nothing, which was true and beside the
point. Adding it required edits in eighteen files here and three in a
consuming product, all of them fixtures, none of them readers. In the same
release `ResolvedWorkspace` gained a required `patterns` and broke that
product's manifest module, which is production code.

### If production assembles the input, test the assembly

A test that constructs the input a production caller assembles is not testing
the assembly. It tests the constructor, and the assembly goes uncovered no
matter how many such tests there are.

The `patterns` manifest category shipped in 1.4.0 non-functional. The workspace
loader resolved it and **no caller passed it to the compiler** — ten source
lists said `[...profiles, ...documents]`. A workspace that declared a pattern
compiled without it, every commit against one was refused, and a visual session
drew every view empty. **1800 tests passed**, because every one of them handed
the compiler an explicit source list and so not one exercised the path a real
workspace takes. It was found by opening the editor.

So: when a verb reads a manifest, at least one test should read that manifest
rather than hand over a list. The repair here was to compile the journey
fixture *through* its own manifest, which is the right shape precisely because
it stops constructing the thing under test.

The general form is the same family as readers-and-constructors above, seen
from the other end: **know whether your fixture is standing in for the caller
or for the caller's input.** Only the second is safe to fake.

### An allowlist cannot fail for the author who wrote it

A closed enumeration standing in for a rule is a latent defect wherever the
entries happen to cover the author's own case. The author is then structurally
the last person able to notice: their case works, and the list is only wrong
for someone whose case is not in it.

Three instances in one week, two here and one in a consuming product:

- `REFERENCE_PREDICATES`, six named predicates deciding which sheet a workbook
  value lands on. Correct on the day it was written, and stale the moment the
  compiler grows a ref-valued predicate, which then round-trips into the
  overflow sheet and reads as though the mapping had not recognised it. The
  same file records that happening once already, to a state's `concept/kind`.
- `PROFILE_ALIAS_GLYPH`, a two-entry map giving a canvas icon to
  `compiler-module` and `repository-file`. **Both are this repository's own
  extension kinds.** The self-model rendered correctly across 189 concepts
  while every adopter's profile-declared kind drew a blank icon slot.
- A consuming product's `COMPILABLE_FORMATS`, which dropped `patterns`.

In each case the rule was available and cheaper than the list: *is this claim
ref-valued*, *what core kind does this descend from*, *is this format one the
loader resolves*. And in each case a rule cannot go stale, because it asks the
question rather than remembering the answers.

**The distinction that matters is what the list governs.** A curated summary
may name what it chooses to show: `renderBudgetedContext` lists five detail
predicates because a budgeted brief is editorial, and omitting a sixth is a
choice rather than a fault. A **router or a gate** may not, because there the
omission is silent and reads as absence. Ask which one you are writing.

The prompt to go looking: whenever a list decides where something goes or
whether something passes, check whether every entry is one you authored. If
so, you cannot be the one who finds the gap, and the test that would catch it
has to come from outside your own case.

### An empty set is not a finished one

A surface that reports progress must not infer completion from emptiness.
The arithmetic that looks right is wrong at zero:

- `done = answered === questions` ticks when a wave carries no questions;
- "no open questions" reads as complete when nothing was asked;
- a fallback group like `quiet` claims calm about a project nobody has begun.

In each case the empty reading is the **flattering** one, and the honest
question is not "is the count zero" but "was anything asked". Read the state
that says so — `opened` on a wave, whether any wave carries a question —
rather than a count that happens to be zero.

This is recorded because it recurs. Five instances were found in a single day
across this repository and one consuming product: a wave rail, this
repository's report renderer, a project dashboard, this repository's `design`
completion claim, and the same claim in that product's own interview surface.
**Four of the five predated the release that made the shape visible.** Adding
a legitimately-empty state is therefore a good moment to go looking for who
infers completion from emptiness — the state is new, the fault usually is not.
`docs/INTERROGATION.md` carries the interrogation-specific form.

### A check that reads the vocabulary cannot see what a declaration compiles to

What a declaration *means* is the vocabulary. What it *becomes* is the graph.
A check written against the first passes over anything that appears only in
the second, and it passes **silently**, because from the vocabulary's side
there is nothing to see.

Three checks, written independently, all with this shape:

- `YM914` refuses a catalogue naming a kind its loaded profile does not
  declare. It tests **declaration**, never **reachability** — whether any
  document format the compiler compiles can actually produce that kind.
- A consuming product's catalogue vocabulary guard, the same test, reached
  independently and for the same reason.
- The wave-gate rule in `docs/adr/0125-*`, which reads a wave's
  **description**. Prose is a third thing that is not the graph either.

Each author believed their check covered the case.

The worked example shows why the failure is unguessable rather than merely
unchecked. `states:` is a key inside an ordinary `yarramate/v1` document —
there is no separate evolution format — and the compiler mints a `plateau`
concept from each entry. `implementation-path-missing` fires on there being
no `workPackage`, `deliverable` or `plateau`, so **declaring a state closes
it**. Nothing in the document says the two are the same thing; `states` and
`plateau` are different words. And the one mechanism designed to answer
"where did this come from" misdirects: the minted claim's source pointer is
`['states', index, 'kind']`, a field whose value reads `transition`. A reader
doing exactly the right thing lands on a line that does not contain the word.

**For any check over declared things, ask what the compiler does with the
declaration, and read the graph rather than the vocabulary to find out.**
Composition changes only *who* inherits the blind spot — a workspace adding
to a base catalogue inherits every trigger it ships and can decline none,
while a host replacing that base inherits none and must re-derive everything,
including the parts that were right — and never whether the blind spot exists.

A closing caution, because the obvious response to this rule is a reachability
check and it would have been wrong here. All 62 core concept kinds are
directly authorable today, so declared and reachable coincide, and such a
guard would pass on every workspace anyone can construct. **A guard is worth
building when the failure it detects is reachable from the current state of
the world, and worth declining when it is only reachable from a design change
nobody has made yet** — the second ages into decoration, and the divergence
arrives long after anyone last read it. The counter-example is a consuming
product's migration guarded on the previous migration's exact bytes: a hand
edit would have made it a silent no-op behind a green tick, and that failure
was reachable the day it was written.

A change a user would notice belongs in `CHANGELOG.md`, under the version
being prepared, in the same pull request that makes it. A change nobody outside
the repository can see does not. When a `feat`, `fix` or `perf` commit
genuinely owes no entry, say why in the commit with a `Changelog: none`
trailer, so the reason lives in the history rather than in someone's memory.

Before tagging a release, `pnpm changelog:check` names every commit since the
last tag that changed what a user sees and wrote no entry. It is a release
backstop, not a per-pull-request gate: six changes once reached a release
undocumented, one of them breaking, because nothing read the file.

Generated files under `.yarramate-out/` and `dist/` are not committed.
Acceptance, authorship, and review are provided by Git; do not add a parallel
approval workflow.

By contributing, you agree that your contribution is provided under the
repository's MIT License. No contributor licence agreement or commit sign-off
is required.
