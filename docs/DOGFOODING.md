# Modelling YarraMate with YarraMate

The `.yarramate/architecture` directory contains the canonical native architecture model
for this repository:

- `product.yaml` — product goals, requirements, and capabilities;
- `engine.yaml` — compiler, CLI, behavior, and semantic data;
- `repository.yaml` — contracts, decisions, roadmap, and adapter prototype.

The documents use qualified references and the bundled
`yarramate/core@0.1` profile. The engine document selects the explicit
`yarramate/development@1.0` profile from
`.yarramate/profiles/yarramate-development.yaml`, dogfooding extension kinds and inherited
Core semantics.

The model currently covers:

- product goals and authoritative requirements;
- compilation, validation, and machine-context capabilities;
- compiler, CLI, profile catalogue, and optional LikeC4 prototype;
- parse, validation, compilation, and check behavior;
- safe `init`, `add`, and `connect` authoring behavior;
- optional adapter subject-mapping validation;
- canonical graph-v2 serialization and schema conformance;
- explicit deterministic workspace resolution;
- provider-neutral evidence evaluation over existing graph identities;
- provider-neutral workspace reconciliation that reports unresolved evidence
  without mutating intent;
- optional Graphify node observation through explicit subject mappings;
- schemas, catalogues, native documents, diagnostics, and semantic graphs;
- the product contract, ADR collection, and roadmap.

It is checked through the same compiler and CLI exposed to users:

```sh
pnpm self:check
pnpm self:check:json
```

The regression test in `test/self-model.test.ts` also compiles the model through
the public library interface.

Canonical dogfooding inputs live together under `.yarramate/`. Optional
integration configuration remains visibly subordinate to that workspace and
does not enter Core. Derived outputs live under the ignored
`.yarramate-out/`; they can be deleted and regenerated without changing the
architecture.

## Three gates catching each other, 2026-08-30

Recorded because it is the clearest run of this repository's own machinery
against itself, and because none of it was reachable from the test suite.

Cutting 1.13.0 began with a self-model pass. Each gate caught the omission
introduced by the previous fix:

1. **`reconcile` found an unclaimed artifact.** A new module,
   `src/visual-app/focus-neighbourhood.ts`, was one of 151 files in the
   declared coverage scope and the only one no observation claimed. The suite
   was green: nothing tests whether the model mentions the code.
2. **The interview found the concept unwired.** Declaring
   `select-focus-neighbourhood` to claim the file left an `applicationFunction`
   that nothing performed, and `ask --open` asked the obvious question —
   *"Who or what performs Select focus neighbourhood?"* — moving the interview
   from 0 open to 1.
3. **The adapter found the mapping missing.** Adding the assignment then broke
   `export-project` with `YMLC102`, a projected concept with no LikeC4
   mapping. Both a concept and a relationship mapping were needed; the first
   alone left the relationship unmapped.

Final state: 354 concepts, 476 relationships, 0 unclaimed of 151, 313 of 313
observations confirmed, interview 0 open of 51.

The shape worth keeping is that **a test suite cannot see what nothing
produces.** A green suite says a claim that was made is still true; it says
nothing about a claim nobody made. Each of these three gates reads a different
absence — an artifact no observation claims, a subject no relationship reaches,
a concept no mapping projects — and none of them is a test.

The same week produced the remedy, from the other side. A workbook reader
mishandled a cell shape this repository's own writer had never emitted — a
cell carrying a reference and no value, which Excel writes for a formatted
empty cell. No test could have produced it, because nothing here produced it.

What surfaced it was building a feature that emitted the shape for the first
time: styling a column means styling its empty cells, so the new writer wrote
one, and the round-trip test failed on the cell beside it.

The defect was present in the reader's **first commit** (`9f99b84`,
2026-08-27) and shipped in **eight releases over three days**, v1.6.0 through
v1.12.0. It was reachable that whole time from any workbook a person had
opened and saved.

Three days rather than three years is the useful number, because it removes
the comfortable reading. This was not old code nobody had looked at: it was
written correct-looking, reviewed, tested and shipped eight times in
seventy-two hours, and not one of those releases could have surfaced it.
Elapsed time was never what protected it, and neither was usage. The
condition for surfacing it was somebody emitting a shape nobody had emitted
yet — so a bug that survived three days for this reason would have survived
three years for the same one.

So the remedy to "a suite cannot see what nothing produces" is not to wait for
a consumer to trip over it. It is to **build the shape you have never
emitted.** A reader that only ever meets what its own writer produces is
tested against half its input, and the missing half is whatever the outside
world writes.

An adopter then proved the defect live in the published release and reachable
through a real import path, which is what turned it from a bug found in
passing into the reason to cut a release. Producing the shape is what finds
it; a consumer is what tells you it mattered.

## Observed and resolved semantic friction

The first self-model did not require a new concept or relationship kind. It did
expose missing semantics that should inform later slices:

- LikeC4 identity needed a separate adapter mapping rather than native
  metadata.
- Repository observations needed a separate evidence overlay rather than
  observed claims in graph v2.
- Accountability and architectural restrictions needed stable concise syntax
  rather than hand-authored generic relationships.

Qualified cross-document references were implemented directly from the first
observation and now keep the three semantic areas independently reviewable.
Controlled operational lifecycle status now marks implemented capabilities and
engine concepts as `current` without introducing an approval workflow.
Canonical product and current-engine projections now generate focused JSON
context directly from the three-document graph.
Repository files that need identity are modelled as first-class
`repository-file` concepts in the development profile. The implementation
traceability projection connects them to engine concepts without introducing a
generic path metadata field.
The self-model now includes the safe authoring services and their CLI
regression tests. Their explicit-source contract was derived from using an
extension profile and qualified cross-document references in this repository.
The governed-change regression fixture uses a separate LikeC4 subject mapping.
Only stable LikeC4 concept identities are mapped; relationship identities are
not fabricated from source position.
The repository model compiles through `self:compile` to the same normative
graph-v2 JSON consumed by projections and adapter mapping validation.
The root self-model and governed-change regression fixture use separate
manifests, preventing test material from entering the dogfooding workspace.
The root manifest also evaluates `.yarramate/evidence/repository.yaml`. Its confirmed
`repo:` locators are checked against real repository files in the evidence
regression suite; the generic engine still treats those locators as opaque.
The engine model now uses singular owner references for accountable
stewardship and identified constraint references for the product boundaries
that each module must preserve. These compile into ordinary graph-v2 claims;
they add neither approval workflow nor constraint-satisfaction policy.
The `maintainer-tool-neutral-engine` projection queries those claims directly,
showing that ownership and constraints are usable semantic context rather than
write-only authoring fields.
The repository model also declares the shared source-located document loader,
which keeps schema-backed companion formats aligned on parsing and diagnostic
behavior without widening the public compiler API.
Check orchestration and shared CLI support are modelled as repository files
behind the unchanged `runCli` interface, keeping command complexity local
without multiplying public entry points.
The `likec4-export-path` projection and its explicit adapter mapping generate
a self-contained LikeC4 project from YarraMate's own native engine model. This
exercises precise subject selection, projection evaluation, mapping
validation, semantic metadata preservation, and project materialization end
to end.
The same projection includes the development profile's `repository-file`
kind. Its adapter profile maps that semantic kind to LikeC4 `artifact` while
the generated `yarramateKind` metadata retains the qualified development kind,
proving vocabulary extension does not leak into Core or lose provenance.
`self:check:likec4` exercises all repository visualization projections without
writing derived files, while `self:export:likec4` proves repeatable
materialization of the single `.yarramate-out/likec4` project.
The same project renders the compiler validation pipeline as an ordered
dynamic view over existing triggering relationships. The order lives only in
the adapter project; the relationships remain canonical native claims.
Both commands now delegate semantic orchestration to the same exported
`prepareLikeC4Export` operation; the CLI retains argument handling, result
formatting, and staged, marker-last filesystem publication rather than
reimplementing the adapter pipeline. Failures from that path carry authored
source locations:
native declarations identify missing mappings, while invalid adapter-owned
values identify their subject or kind mapping documents.
The remaining gaps are observations, not permission to add generic metadata.
Each requires explicit claim syntax, profile semantics, or an adapter contract.

`.yarramate/architecture/evolution.yaml` declares the repository's native foundation,
adapter foundation, and architecture-state foundation as ordered planning
contexts. Selected engine and repository subjects use `presentIn`, while
`.yarramate/projections/state-foundation.yaml` exercises state selection. `self:compare`
classifies the native-foundation-to-state-foundation delta through the same
public API and CLI available to consumers; no copied model or lifecycle
overloading is involved.

The bounded `state-engine-adapter`, `state-engine-target`, and
`state-engine-change` projections render the repository before, after, and
across the architecture-state engine slice. The shared repository LikeC4
mapping keeps external identities explicit and singular.
`.yarramate/likec4-project.yaml` composes these with the export-path
projection, the focused product-journeys projection, and eight native starter
projections into one derived model containing fifteen independent views,
including the compiler pipeline dynamic view.
Explicit mapped node predicates and
native relationship-identity predicates retain each projection's exact
membership after model union; the technology template currently demonstrates
that an unmatched portable projection remains a valid empty view.
The landscape projection is rendered as LikeC4's special `index` view while
retaining `starter-landscape@1.0` in the ownership marker. This prevents an
implicit 99-element union view from becoming the project landing page.
Rendered-view inspection drove optional isolated-concept exclusion in the
four broadest starter projections. In this workspace it reduced landscape
from 36 to 22 nodes, strategy from 7 to 4, application cooperation from 27 to
14, and information structure from 55 to 48, without dropping any selected
relationship endpoint. Sparse business and roadmap views retain isolated
concepts.
The focused `engine-components` projection opts into descendant kind matching.
It selects the Core `applicationComponent` kind and the repository's explicit
development-profile descendants without making the broad starter application
view ancestry-aware. Descendant expansion therefore remains deliberate and
reviewable.
The `product-journeys` projection dogfoods the two primary entry points:
existing-project discovery and architecture-first design. Both influence the
same shared architecture context and are constrained by the stable CLI and
the separation of evidence from declared intent.
The repository also models and observes the portable agent skill, journey
guide, and CLI-level journey tests. The tests execute a repository-discovery
fixture and a pre-build design fixture rather than validating prose alone.
The consumer package, installation guide, and package-consumer tests are also
native subjects. The package test builds the real tarball, rejects repository
development content, invokes npm-style binary symlinks, runs both journey
primitives from the packed runtime, and resolves Codex and Claude entrypoints
to the same skill directory.
The comparison view carries adapter-owned change presentation and valid local
LikeC4 styles; neither appears in native graph claims.

`.yarramate/contracts/yarramate-core-0.1.yaml` declares the first tool-neutral release
boundary and is included explicitly by the root workspace. `self:check`
validates its real schema files, package exports, and binary alongside the
architecture model. `.yarramate/projections/core-contract-foundation.yaml`,
`self:contract`, and `self:compare:contract` expose the new target and its
delta from the preceding state foundation. LikeC4 schemas remain intentionally
outside the Core contract.
