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
- **The pattern owns the pairs it wires.** Any other authored
  relationship between a wired pair — reversed, or a different kind — is
  a compile error. Edges from a part to anything *else* are free.
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

Phases 1 and 2 of #268 have landed. **Fold and unfold** on the canvas is
phase 3, along with the connect tool offering two instances only their
port kinds instead of all eleven the relationship table permits between
groupings. Both read what is declared here; neither changes it.

Generating an unbound part rather than requiring it to exist is also left
open. An instance that binds nothing is exactly the greenfield case, and
nothing in these decisions prevents a later phase from minting one.

Generating an unbound part rather than requiring it to exist is also left
open. An instance that binds nothing is exactly the greenfield case, and
nothing in this decision prevents a later phase from minting one.
