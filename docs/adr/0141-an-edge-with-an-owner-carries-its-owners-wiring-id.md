# An edge with an owner carries its owner's wiring id

Status: accepted

Two wires can name one triple. Before this, both minted, so one relationship
became two relationship claims (#460, observed by the ApertureX adopter session
in their own pack test, against released 1.16.0 and 1.17.0):

```
id: app-mapping-access-payload   subject: map-x  →  access  →  shared-payload   origin: declared
id: map-x-access-source          subject: map-x  →  access  →  shared-payload   origin: declared
```

The shape is an app pattern whose `mapping` slot takes an instance of a mapping
pattern with parts of its own: the app wires `mapping --access--> payload`, the
mapping wires `self --access--> source`, and one document binds both to the same
data object.

Nothing caught it because the wiring loop asked two questions before minting and
neither covers this. Does an **authored** relationship already say it
(`authoredByPair`), in which case the wire is satisfied and mints nothing; and
is the derived id already a **declared subject** (`declaredIds`), which is
`YM420`. It never asked whether a **previously minted wire** had said it, and
the two ids differ by construction, so `YM420` could not fire either. An
authored edge satisfies *both* wires, which is why a workspace that writes the
relationship down never meets this and one that leaves it to expansion does.

## Decided

**One claim per triple, and OWNERSHIP decides which id survives.**

> An edge with an owner carries its owner's wiring id; an edge with only guests
> carries the id of its triple.

- A wire whose `from` is `self` **owns** the edge, because the edge leaves that
  instance. It mints, and its ADR 0123 id survives unchanged.
- A wire whose `from` is a slot is a **guest** naming an edge that leaves
  somebody else, and defers.
- Where every wire in a collision is a guest, the owner's wire is absent —
  typically its instance is greenfield and an unbound slot wires nothing — so
  there is no ADR 0123 id to prefer, and the id comes from the triple:
  `{from}-{kind}-{to}`.

**A group of one is not a collision, and this exception is the load-bearing
half.** A wire between two SLOTS of one pattern (`component --composition-->
interface`) has no `self` endpoint and therefore no owner, but nothing competes
with it. Its ADR 0123 id survives untouched. Without this, ownership would
rename every slot-to-slot edge in every workspace — including ADR 0123's own
worked examples, `contact-system-api-component-composition-interface` — which is
precisely the migration ownership exists to avoid. This was not reasoned out in
advance: applying the rule without it renamed
`sys-api-component-composition-interface` in the existing suite, which is how it
was found.

**Nothing that compiles today changes id.** Every existing edge is either a
group of one or has an owner.

## Why ownership rather than the alternatives

- **Refusing the collision** (a new diagnostic saying two patterns wire the same
  pair) was refused. Two wires naming one triple are two patterns **agreeing**,
  and agreement is already treated as one fact when it is authored, since an
  authored edge satisfies every wire that names it. `YM418` is what exists for
  the case where statements *disagree*. Refusal would also make a legal
  composition of two independently-authored patterns an authoring error, at
  exactly the shape the reporting adopter now ships into every new project.
- **Deriving every minted id from the triple** was refused. It is stable and
  order-independent, but it rewrites the ADR 0123 contract and moves every
  minted wiring id in every workspace. That is a migration priced as a dedup.
- **Keeping today's ids and picking the survivor by sorting** was refused. It
  fixes ordering but not stability: adding or removing a further guest could
  change which id survives. Ownership plus a triple-derived fallback is stable
  under both.

## Consequences

- **The no-owner fallback carries real traffic and is not a corner.** Two apps
  sharing one *greenfield* mapping produce two guest wires and no owner at all,
  because the mapping has bound nothing and an unbound slot wires nothing. That
  is the adoption state ADR 0140 exists to surface, so the fallback needed to be
  a first-class rule rather than a footnote.
- **Two id derivations now coexist in one id space**, one built from slot names
  and one from subject ids, selected by whether an owner exists. A reader
  holding an id can no longer tell how it was derived without knowing the
  pattern topology.
- **They can collide.** A data object whose id is literally `source` gives the
  guest-only triple `(map-x, access, source)` and so the triple-derived id
  `map-x-access-source`, which is also the ADR 0123 id of an owner wire whose
  slot is named `source` bound to a different subject. Same id, different
  triples. It lands on the existing `declaredIds` check and is refused as
  `YM420`, so it fails loudly rather than silently, which is the right
  direction. `YM420`'s message says the id "is already a declared subject",
  which is not quite what happened; left as is rather than widened on
  speculation, since the case is constructible but has not been observed.
- **Two owners on one triple cannot occur.** `self` differs per instance, and
  within one instance `YM315` already refuses two slots naming one subject. The
  implementation sorts the owners anyway rather than trusting that from a
  distance.
- Minting moved from inside the per-instance loop to a pass over the collected
  candidates, because whether a wire mints depends on wires belonging to other
  instances. Claim ORDER is unaffected downstream: `claims` is sorted by id
  before emission.

## Provenance

Observed and pinned by the ApertureX session, reproduced here before filing.
The ownership rule and its wording are theirs, arrived at after two earlier
proposals were withdrawn under review. The group-of-one exception and the
no-owner reachability are this session's, both found by measurement rather than
argument.
