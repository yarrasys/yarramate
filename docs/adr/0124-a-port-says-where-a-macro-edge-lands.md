# A port says where a macro edge lands

Status: accepted

[ADR 0123](0123-a-pattern-binds-the-parts-it-wires.md) made the shape of a
pattern normative: an instance binds its parts and the compiler wires them.
It left the grain problem exactly where #268 found it. An architect
authors one fact, "System API serves Process API", and canonical ArchiMate
wants that fact spelled between members: the provider's service serving
the consumer's component.

Phase 0's interim convention shows the cost precisely. The contact-update
fixture authors the three API-grain servings as ordinary relationships and
names the member wiring in a `description`:

> Met by salesforce-write-service serving contact-prc-api.

That correspondence is prose. Nothing mechanical detects divergence, and
the fixture's own comment says so. Both grains are authored, and only a
reader keeps them in step.

## Decision

**A pattern declares `ports`: where a macro-grain edge of a given
relationship kind lands.**

```yaml
ports:
  - kind: yarramate/core@0.1#serving
    out: service
    in: component
```

A relationship authored between two pattern instances, whose kind both
patterns give a port, is expanded: from the **source** instance's `out`
slot to the **target** instance's `in` slot. `sys-api serving prc-api`
becomes `sys-service serving prc-component`.

- **The macro edge survives.** It is an authored fact, not a derivation,
  and it is what a collapsed view has to draw. This is the property every
  upward-abstraction attempt lost: a view that collapsed to groupings drew
  zero edges because the real ones ran between members. Here both grains
  are in the graph and both are true.
- **Both ends must have a port for the kind.** The `out` comes from the
  source's pattern and the `in` from the target's, so a kind only one side
  ports is not a macro edge. Anything else between two instances is an
  ordinary relationship and is left alone: groupings may legally relate,
  and a pattern that says nothing about a kind has not claimed it.
- **Expansion is idempotent, the phase 1 rule.** Where the canonical pair
  is already authored, nothing is minted. This is what turns the fixture's
  three prose assertions into guarantees without changing a line of it:
  the compiler expands each macro edge to exactly the pair the description
  names, finds it already there, and mints nothing. Divergence would show
  up as a second edge rather than as a description nobody checks.
- **A landing slot must be bound** (`YM421`). The macro edge is a promise
  the expansion keeps, so an instance whose `out` or `in` slot is unbound
  cannot cash it. Reported against the macro edge, which is the line
  someone would have to change.
- **The expanded id is the macro edge's own, suffixed `-expansion`**, and
  the minted claim is sourced to the macro edge's line. Both follow ADR
  0123: the claim is `declared`, because the macro edge is where the
  author said it, and `yarramate/graph/v2` does not move.
- **`out` is never `self`.** An edge leaving the instance is the macro
  edge again.

## Excluded options

- **Replacing the macro edge with its expansion.** It would make the
  collapsed view edgeless again, which is the failure #268 opened with.
- **Ports as a map keyed by relationship kind**, as the issue sketches
  (`serving: { out: service, in: component }`). An array of `{kind, out,
  in}` matches `wiring` next to it, keeps globally qualified kinds out of
  key position, and gives a duplicate port somewhere to be reported
  against.
- **Erring when a macro edge's canonical pair is authored differently**
  than the port says. The port owns where an edge of that kind *lands*,
  not every relationship between two instances' parts: a service may
  legitimately serve a component in another instance for reasons that have
  nothing to do with the macro fact. Phase 1's ownership rule is
  deliberately narrower than "the pattern owns its parts", and this keeps
  the same line.
- **Narrowing the connect palette here.** The issue wants two `api`
  instances offered only their port kinds instead of all eleven. That is a
  UI affordance over this declaration and belongs to phase 3; nothing
  about it changes what is decided here.
- **Expanding a macro edge whose ends are instances of *different*
  patterns.** Already supported and deliberately unremarked: each end
  reads its own pattern's port, so an `api` serving a `datastore` works
  the moment both declare a `serving` port. Nothing special is needed.

## Consequences

The pattern schema gains an optional `ports`; one new diagnostic,
`YM421`. A pattern with no ports behaves exactly as it did after phase 1,
so this is additive over an additive change.

The contact-update fixture needs no edit beyond declaring the port: its
three macro commitments and the member wiring beneath them already agree,
and the compiler now checks that rather than trusting a description. That
is the correspondence #268's own comment said phase 1 would verify.

Phase 3, the canvas fold and the port-narrowed connect tool, is untouched
and still stands. It reads this declaration; it does not change it.
