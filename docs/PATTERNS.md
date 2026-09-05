# Patterns

A **pattern** is the shape a concept kind promises: the parts an instance
binds, and the wiring the compiler mints between them. Where a profile
declares vocabulary — what kinds exist and what they specialize — a
pattern declares structure.

Normative schema: `schema/yarramate-pattern.schema.json`, format
`yarramate/pattern/v1`, package export `yarramate/schema/pattern`.
Decision: [ADR 0123](adr/0123-a-pattern-binds-the-parts-it-wires.md).

## The problem it solves

An architect authors one fact: "System API serves Process API". Canonical
ArchiMate spells the API as four elements and five relationships — a
component, the interface it composes, the service that interface exposes,
and the grouping that holds them. Every attempt to get the simple picture
back out of the detailed model derives it **upward**, and upward
abstraction is lossy: it has to guess which member a lifted edge attaches
to, and a view that collapses to groupings draws no edges at all because
the real ones run between members.

A pattern inverts it. Author at the macro grain and expand **downward**,
which is a compiler rather than a heuristic: same input, same output, no
guessing.

## The document

```yaml
format: yarramate/pattern/v1
id: api-led
version: "1.0"
patterns:
  - kind: yarrasys/api-led@1.0#api
    parts:
      component:
        kind: yarramate/core@0.1#applicationComponent
        required: true
      interface:
        kind: yarramate/core@0.1#applicationInterface
        required: true
      service:
        kind: yarramate/core@0.1#applicationService
    wiring:
      - { from: self,      kind: yarramate/core@0.1#aggregation, to: component }
      - { from: self,      kind: yarramate/core@0.1#aggregation, to: interface }
      - { from: self,      kind: yarramate/core@0.1#aggregation, to: service }
      - { from: component, kind: yarramate/core@0.1#composition, to: interface }
      - { from: interface, kind: yarramate/core@0.1#assignment,  to: service }
```

- `kind` is the globally qualified concept kind this pattern shapes. What
  that kind specializes is the profile's business; a pattern never
  restates it.
- `parts` declares slots by name. A slot names the kind a bound subject
  must be, and whether an instance must bind it.
- `wiring` describes relationships between `self` — the instance — and
  the slots. A slot may not be called `self`.
- A kind has at most one pattern (`YM411`).

Pattern documents join the workspace manifest under `patterns`:

```yaml
patterns:
  - patterns/*.yaml
```

## The instance

```yaml
- id: contact-system-api
  kind: api
  name: System API
  parts:
    component: contact-sys-api
    interface: contact-sys-api-interface
    service: salesforce-write-service
```

**Binding, not generation.** A slot names a subject that already exists,
and that subject keeps everything it had: its own name, description,
owner, evidence, attestations, and every relationship it participates in.
What the pattern removes is the wiring, which was ceremony. On the
contact-update journey this is twelve hand-authored aggregations replaced
by four `parts` blocks.

## What the compiler does

Expansion happens at compile time and lands in the semantic graph. Nothing
is ever written back to a document, so a pattern edited today re-wires
every instance on the next compile.

- **A minted claim is `declared`**, sourced to the binding line that
  produced it — `component: contact-sys-api` is where the author said it,
  the pattern contributing only which kind of edge a bound pair gets.
  `yarramate/graph/v2` is unchanged, and the expanded graph is
  indistinguishable from a hand-authored one, which is what lets the
  Archi and LikeC4 exports see pure ArchiMate without learning what a
  pattern is.
- **Wiring ids are derived**: the instance id, the source slot where it is
  not `self`, the relationship's core kind, then the target slot.
  `contact-system-api-aggregation-component`,
  `contact-system-api-component-composition-interface`.
- **Expansion is idempotent.** Where an authored relationship already says
  exactly what a wiring edge says, nothing is minted: the authored one
  satisfies the wiring. A model can adopt a pattern without touching a
  line and delete the redundant relationships afterwards.
- **One relationship, one claim, when two wires name it** (ADR 0141). Two
  patterns can wire the same triple — an app wiring `mapping access
  payload` and the mapping wiring `self access source`, both landing on
  one data object — and only one claim is minted. Which id survives is
  decided by OWNERSHIP: a wire whose `from` is `self` owns the edge,
  because the edge leaves that instance, and keeps its derived id above.
  A wire whose `from` is a slot is a guest naming somebody else's edge,
  and defers. Where every wire is a guest, which happens when the owning
  instance is greenfield and so its own wire never fires, the id comes
  from the triple instead: `{from}-{kind}-{to}`. A wire nothing competes
  with is not a collision and is untouched, including a wire between two
  slots of one pattern, which has no `self` endpoint but no rival either.
- **The pattern owns the pairs it wires.** Any other authored
  relationship between a wired pair — reversed, or a different kind — is
  a compile error. Edges from a part to anything *else* are free.
- **A slot can admit a family of variant subkinds** (#449). A part matches
  its bound subject's kind exactly by default; `kindMatching: descendants`
  admits any kind whose lineage includes the slot kind, so one slot can
  stand for a family and choosing which member fills it is itself the
  decision. The motivating shape is a decisional dependency: a `secrets`
  slot admitting `bundled` or `vault`, each variant carrying its own
  pattern, so the choice is what opens the next set of questions.

  ```yaml
  parts:
    secrets:
      kind: "acme/platform@1.0#secret-store"
      kindMatching: descendants
  ```

  The word means the same here as on catalogue selectors and on
  `missing-relationship`, so it is one vocabulary rather than two. Sharing
  an ancestor is not descent: a sibling kind under the same core parent is
  still refused. Note that a descendant resolves to the same CORE kind as
  the slot kind, so the relationship table returns the same verdict for
  both; widening the slot cannot widen what the wiring may legally say.
- **A slot's wiring says whether the instance HOLDS the part or USES it**
  (ADR 0143). `PatternMembership.wiring` is `owned` where a wire runs
  `self -> slot`, `context` where one runs `slot -> self`, and `unwired` where
  the pattern declares the slot and wires nothing through it. Both directions
  is `owned`: holding something out is the stronger statement. It is read from
  the PATTERN, so it holds whether or not the slot is bound, and an editor
  folding instances draws owned and unwired members inside the box while a
  context member — the upstream API it calls, the plane it runs on — stays
  outside it.
- **An unbound optional slot wires nothing**, silently.
- **A pattern that cannot expand legally fails once, at the pattern.**
  The slot kinds fix both endpoint kinds, so whether the relationship
  table permits a wire is knowable without any instance; a forbidden wire
  is `YM404` against the pattern rather than against every instance that
  was authored correctly.

## Ports: where a macro edge lands

A pattern may also declare **ports** ([ADR 0124](adr/0124-a-port-says-where-a-macro-edge-lands.md)):

```yaml
    ports:
      - kind: yarramate/core@0.1#serving
        out: service
        in: component
```

A relationship authored **between two instances** whose kind both patterns
port is a macro-grain fact, and it is expanded to the canonical pair the
ports name: out of the source instance's `out` slot, into the target
instance's `in` slot. `sys-api serving prc-api` becomes `sys-service
serving prc-component`.

- **The macro edge survives.** It is an authored fact, and it is what a
  collapsed view has to draw — the property upward abstraction always
  lost, where a view that collapsed to groupings drew no edges because the
  real ones ran between members. Both grains are in the graph and both are
  true.
- **Both ends must port the kind.** The `out` comes from the source's
  pattern, the `in` from the target's. A kind only one side ports is not a
  macro edge; anything else between two instances is an ordinary
  relationship and is left alone.
- **Idempotent, as wiring is.** Where the canonical pair is already
  authored, nothing is minted — which is what makes an agreement between
  the two grains *verified* rather than trusted. Divergence shows up as a
  second edge rather than as prose nobody checks.
- **A landing slot must be bound** (`YM421`): a macro edge is a promise
  the expansion keeps, so an unbound `out` or `in` is a promise the model
  cannot cash.
- The expanded relationship takes the macro edge's id suffixed
  `-expansion`, and its claim is sourced to the macro edge's line.
- `out` is never `self` — an edge leaving the instance is the macro edge
  again.
- **The expanded pair is judged against the relationship table**, and a
  forbidden one is `YM404` against the macro edge. Wiring's legality is
  settled when the pattern resolves, because the slot kinds fix both
  endpoint kinds; a port's cannot be, because the two ends belong to
  different patterns and neither knows the other's slots. Note that the
  macro edge itself can be perfectly legal — two groupings permit almost
  everything — while the pair it lands on is not.

## The folded view, and the narrowed palette

Two things fall out of ports rather than needing a mode of their own.

**A view over the pattern kind is the fold.** Because a macro edge survives
its expansion and stays an ordinary subject, a projection selecting the
pattern kind with `relationships: between` draws one box per instance with
the macro edges between them — no canvas mode, no second renderer:

```yaml
query:
  kinds:
    - yarrasys/api-led@1.0#api
  relationships: between
```

Unfolding is the same query without the kind filter, or any view that
includes the parts. This is the property upward abstraction could never
give: a view that collapsed to groupings drew no edges, because the real
ones ran between members and nothing had authored the macro fact.

**The connect palette narrows to the ported kinds.** Between two pattern
instances an editor offers only the kinds *both* patterns port, rather
than the ten of eleven the relationship table permits between two
groupings. That restores the guidance the table gives everywhere else,
and it matches what phase 2 will actually expand: an offer wider than the
intersection would propose edges that expand into nothing. Where either
end has no ports there is no macro grain to speak of and the table's own
answer stands, and a narrowing that came out empty falls back to the
table rather than making the edge undrawable.

A `CanvasNode` carries `portKinds` for this, and the resolved profile
context carries `patternPortKinds` keyed by concept kind.

## Diagnostics

| Code | Meaning |
| --- | --- |
| `YM315` | A part names a subject that does not exist, or two slots name the same subject |
| `YM416` | A required part is unbound |
| `YM417` | A bound part is not of the kind its slot declares |
| `YM418` | An authored relationship contradicts the instance's wiring |
| `YM419` | `parts` on a kind with no pattern, or a slot the pattern does not declare |
| `YM420` | A derived wiring or expansion id is already a declared subject |
| `YM421` | A macro edge's landing slot is unbound on one of its instances |

A pattern document's own faults reuse the existing bands: `YM201` for a
schema violation, `YM401`/`YM402` for a kind that is not available,
`YM302` for wiring that names something that is neither `self` nor a
declared part, `YM404` for wiring the relationship table forbids, and
`YM411` for a second pattern claiming one kind.

## Not yet

Phases 1, 2 and 3 of #268 have landed. What remains open is a canvas
**toggle** for folding — collapsing clusters on whatever view is on
screen, rather than switching to a view authored as folded. That is a
convenience over what a projection already does, not a missing
capability.

Generating an unbound part rather than requiring it to exist is also left
open. An instance that binds nothing is exactly the greenfield case, and
nothing in these decisions prevents a later phase from minting one.

## The interview half

A pattern's questions are the most reusable questions there are — most of
what a pattern IS, expressed as knowledge rather than structure (#346).
Both halves are expressible:

- **Instance-level** needs no special condition: a pattern is a kind, so
  an ordinary question scoped to `yarrasys/api-led@1.0#api` asks every
  instance.
- **Member-level** uses the `fills-pattern-slot` trigger condition
  (ADR 0131): a guard that holds where a subject is bound into a slot,
  narrowed by `patternKinds` and `slots`. Membership survives the compile
  as context (`patternMemberships` on the compilation result), never as
  graph claims — the expansion stays indistinguishable from a
  hand-authored graph. See [docs/INTERROGATION.md](INTERROGATION.md).
- **Vacancy-level** uses `missing-part` (ADR 0140), the mirror: it holds
  for an INSTANCE with a part nothing is bound into, read from
  `patternVacancies` on the same compilation result. This is what makes a
  pattern a questionnaire — the parts an instance has not bound are
  precisely the decisions its adopter has not taken.

  **An instance that declares no `parts` at all is asked about every
  part.** It is not a `PatternInstance` — nothing is collected, nothing is
  expanded, and `YM416` never fires — so it compiles clean with the whole
  template blank, which is exactly the greenfield case this ADR left open.
  Before #447 it reported no vacancies, and no vacancies reads as *fully
  bound*. Its rows carry `required: true` where the part is required,
  which on a successful compile happens only here: an instance that
  declares `parts` and omits a required one is `YM416` and produces no
  result to read.
