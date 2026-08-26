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
  runtime, in every object literal that builds one. **Test fixtures are almost
  always constructors**, so the break lands in a consumer's test suite, which
  is where it is most confusing and least expected.

"Consumers reading the graph see no change" is a true sentence that has
misled someone by the time they read it in a red build. Say which direction
you mean, and say it in the changelog entry rather than leaving it to be
rediscovered.

This is recorded because it was learned the hard way: `portKinds` (#268 phase
3) was described as costing readers nothing, which was true and beside the
point. Adding it required edits in eighteen files here and three in a
consuming product, all of them fixtures, none of them readers.

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
