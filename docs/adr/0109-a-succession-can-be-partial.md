# A succession can be partial

Status: accepted

`supersedes` took a list of predecessor ids and nothing else, so every
succession it could express was total. Most real ones are not.

## What it cost

The GitLab showcase recorded, in structured fields:

- `zoekt-search.supersedes: [es-indexer]`
- `es-indexer.presentIn: [single-instance]` only

GitLab's own `doc/integration/zoekt/_index.md:40`, at the commit that model was
built from:

> Zoekt handles only code search and **does not replace** Elasticsearch or
> OpenSearch. For all other search scopes, including comments, commits, epics,
> issues, merge requests, milestones, projects, users, and wikis, Elasticsearch
> or OpenSearch is still required.

The succession was real and **scoped**: true for code search, false for
everything else. The subject was the indexer, which feeds exactly the scopes the
doc lists, so the unqualified claim failed on its own terms.

The author knew this. The `description` on both subjects carried "for code
search" correctly. What the author could not do was put the qualifier anywhere
the tool would read.

Then the tooling amplified it. `ask --compare` reads the **fields**, not the
prose, and reported the target architecture as `0 added, 4 removed`: the entire
declared future consisted of deleting the one component that was not being
deleted. A reader who trusts the structured surface over the prose beside it,
which is the entire reason for having a structured surface, got the architecture
backwards.

## Decided

**A succession entry may carry the respect in which it supersedes.**

```yaml
supersedes:
  - subject: es-indexer
    inRespectOf: code search
```

The bare string form is unchanged and still means a total succession.

**The respect is a claim of its own**, `yarramate/lineage/supersedes-respect`,
whose id is the succession claim's id suffixed with `~respect`. `GraphClaim` is
a triple, and widening it to carry one optional string would widen the published
graph schema for every claim in the model to serve one predicate.

**The interview asks for it**: `unscoped-succession` fires when a subject
supersedes a predecessor that is **not retired** and records no respect.

## Why the trigger turns on the predecessor's status

A succession that replaced its predecessor outright says so by the predecessor
being gone. Asking that author for a qualifier would be a hum, which is exactly
the failure [ADR 0083](0083-a-kind-nothing-constrains-is-a-label.md) warned of
when it declined to ship a question firing 153 times.

A succession where both subjects remain current is the interesting case: either
the transition is in progress, which the model already permits and calls real,
or the succession is partial. Both are worth a sentence, and neither is
answerable from the graph.

## A selector may now omit its kinds

Succession can be declared on any subject, so the question needed a
kind-agnostic selector. Enumerating the kinds that may carry `supersedes` would
be a list nobody can keep right rather than a constraint, so `subjects.kinds`
became optional and absent now means every concept. This is additive: every
existing selector names its kinds and behaves exactly as before.

## Consequences

- Additive on every surface. The bare form still compiles, still means what it
  meant, and every existing model checks the same way.
- The catalogue goes 1.0 to 1.1, a minor: it adds a question and changes no
  trigger, which is the rule `docs/INTERROGATION.md` sets.
- `INTERROGATION_SEMANTICS_VERSION` does **not** move.
  [ADR 0106](0106-a-report-says-which-engine-answered.md) bumps it only when an
  existing question's answer can change for an unchanged model, and a new
  condition changes no existing answer. The fingerprint in
  `test/interrogation-semantics.test.ts` does move, because that fixture gained
  a question, and its failure message now distinguishes the two causes rather
  than telling every author to bump the version.
- `ask --compare` still reports a removal rather than a scoped succession.
  Recording the respect is what this ADR decides; teaching the comparison to
  read it is a separate change, and the data has to exist first.
