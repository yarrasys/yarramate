# A kind nothing constrains is a label

Status: accepted

From a MuleSoft modelling probe (2026-08-13): model a public API over
Salesforce, built on Anypoint CloudHub 2.0, and ask what the engine can
actually adjudicate about the vendor stack. The honest answer at the time
was the documented boundary — the engine is blind to requirement words and
vendor names (`docs/AGENT-INTERFACE.md`), and no catalogue question asks
about the vendor choice at all. The follow-up question is the interesting
one: what happens if the engine *does* try to categorise, and what happens
if it refuses?

Measurement first. A two-concept probe — CloudHub, an Experience API —
swept concept kind against relationship kind:

| CloudHub kind | `assignment` | `serving` |
| --- | --- | --- |
| `node` | OK | OK |
| `systemSoftware` | OK | OK |
| `applicationComponent` | OK | OK |
| `capability` | YM404 | OK |

The engine draws exactly one line here, and it is not the line a modeller
cares about. It cannot distinguish a node from system software from an
application component — the choice that carries the meaning — and only
notices when a *behavior* kind is asked to be the source of an
`assignment`. Every candidate passes as long as nothing is assigned.

That generalises. The core profile has 62 concept kinds across eight
layers and five aspects, and eleven relationship kinds. Only four
relationship kinds constrain the aspect of an endpoint:

| relationship kind | pinned endpoint |
| --- | --- |
| `assignment` | source: active-structure |
| `access` | target: passive-structure |
| `triggering` | source and target: behavior |
| `influence` | target: motivation |

Against the repository's own model — 238 concepts, 325 relationships —
153 concepts carry a kind that nothing in the graph tests. Reclassify any
of them to any other kind of the same or another aspect and the workspace
compiles identically.

## Rejected: infer the kind

The engine could map `cloudhub-worker` to `node` from the word, or derive
a kind from a subject's relationships. Three reasons not to, all of them
already load-bearing elsewhere:

- The Graphify adapter settled this exact question for evidence and chose
  explicit mapping only: it "does not infer this correspondence from
  labels, paths, communities, or similarity"
  (`docs/GRAPHIFY-ADAPTER.md`). Kind inference is the same inference at
  the classification layer.
- `evidence-intent-separation` in `.yarramate/architecture/product.yaml`:
  observations may support or challenge a proposal but cannot silently
  author declared intent. An inferred kind is declared intent nobody
  declared.
- `deterministic-correctness`: an inferred kind shifts with the lookup
  table, so `check` stops being reproducible across engine versions —
  which is `architecture-drift`, the founding driver, reintroduced by the
  tool. ADR 0082 spent a release removing a record of a judgment nobody
  made; a guessed kind is that forgery one level down.

## Rejected: make it a `check` error

A model that assigns nothing to its runtimes is thin, not contradictory.
`check` reports contradictions; thinness is what the interview is for —
the same split as ADR 0056 (attestation) and ADR 0077 (near-duplicate).
A rule that fires 153 times on the repository's own model is a warning
nobody reads, and it would fail every existing repository on upgrade.

## Decided

A deterministic trigger condition, `unconstrained-kind`, plus one hygiene
question, `kind-untested`, in `catalogues/core-enrichment.yaml` (version
0.7 → 0.8). The engine gains no opinion about any kind; it reports where
its own rules cannot reach.

## The rule, exactly

A subject's kind is *tested* when the subject participates in at least one
relationship claim whose kind pins an aspect at that subject's end of the
claim: a source-end claim counts when the kind pins `source`, a target-end
claim counts when it pins `target`. Nothing else counts — not descriptions,
ownership, states, constraint references, or relationships whose kind pins
neither side.

Three consequences follow from taking that literally:

- **An absent side is permissive, not unknown.** `serving` pins neither
  endpoint, so a hundred `serving` claims still test nothing about the
  kinds at either end. The condition says so.
- **Endpoint aspects resolve through profile lineage**, the same rule as
  subject selectors and relationship kinds in every other condition. An
  extension relationship kind inherits its parent's pins; an extension
  concept kind is answerable exactly when its parent is, so
  `cloudhub-worker` parented under `applicationComponent` is interrogated
  as an application component without the catalogue knowing the word.
- **No profile context, no finding.** When the caller supplies no resolved
  profile the rules are unknown rather than absent, and the condition
  reports nothing instead of inventing a gap.

`relationshipKindEndpointAspects` is published on `ResolvedProfileContext`
for this, alongside the existing kind lineages: the compiler already
resolves the constraint to enforce YM404, and the interview now reads the
same table rather than re-deriving it.

## Why the shipped question is scoped to active-structure

The condition is general; the scoping is a catalogue decision, and it was
made by measurement, not taste. Untested subjects in the repository's own
model, by aspect:

| aspect | untested | subjects |
| --- | --- | --- |
| active-structure | 4 | 21 |
| motivation | 8 | 9 |
| behavior | 43 | 58 |
| passive-structure | 98 | 150 |

Where the untested share is the majority the question is a background hum.
A `repository-file` artifact nobody has modelled a reader for is ordinary
(86 of them here); a service that is realized and serves but is never
sequenced by a `triggering` claim is ordinary. Active-structure is the one
aspect where the missing claim is `assignment` — the claim that says this
element performs something — and where absence is rare enough to read as
an omission rather than as the shape of the model.

Widening to the other aspects is a catalogue edit under a later version,
not an engine change. It is deferred until a model exists where the ratio
inverts.

## Rejected on measurement: a `layers` selector

The first cut added a `layers` filter to the catalogue subject selector,
on the theory that the discriminating axis was layer — ask about
technology and application elements, skip motivation. Scoping by layer
opens 153 questions; scoping by aspect opens 4. Layer is a presentation
grouping, aspect is what the relationship rules actually key on. The
filter was reverted before it shipped, and the selector keeps the two
narrowing dimensions it already had.

## What it catches

Four subjects in the repository's own model: `local-web-browser` and
`nodejs-runtime` (`systemSoftware`), `mcp-adapter` and `profile-catalogue`
(`applicationComponent`). All four are declared runtimes and components
with nothing assigned to them and nothing running on them — the model
names the browser that renders visual sessions without ever saying what
runs in it.

And the MuleSoft case in miniature, which is where the question came from.
The engine still will not choose between `node`, `systemSoftware`, and
`applicationComponent` for CloudHub. It now says out loud that the choice
is currently unfalsifiable, and `authority: either` lets an agent propose
the assignment while a human confirms it.
