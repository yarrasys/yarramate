# A pattern binds the parts it wires

Status: accepted

An architect authors one fact: "System API serves Process API". Canonical
ArchiMate spells it as four elements and five relationships. A day of
dogfooding on the contact-update fixture tried every way to get the
simple picture back out of the detailed model, and every attempt tried to
derive it **upward** from the detail: component-to-component serving that
duplicates the interface chain, nesting that will not nest a service,
groupings that collapse to a view with zero edges, rollup that has to
guess which member a lifted edge attaches to.

#268 inverts it. Author at the macro grain and expand **downward**, which
is a compiler rather than a heuristic: same input, same output, no
guessing. That is what this repository already is. The exclusion of
derivation (ADR 0083's lineage) is about inferring conclusions *from*
claims; expansion elaborates authored intent *into* claims, which is what
the compiler has always done to YAML.

Phase 0 shipped: `yarrasys/api-led@1.0#api` extends `grouping`, and a
shape-contract catalogue asks the three questions the vocabulary cannot
enforce. It gave the cluster an identity a requirement can point at and
an owner can hold. It could not make the shape normative. This is Phase
1: the pattern document format and the expansion stage.

## What the fixture actually looks like

The issue pictures an instance whose parts are generated: `kind: api` and
three lines, expanding to four elements and five relationships with
derived child ids. Reading the contact-update fixture changes that
picture.

`contact-system-api` is three lines. Its parts are not. `contact-sys-api`,
`contact-sys-api-interface` and `salesforce-write-service` carry their own
names, descriptions, owners and evidence, and they are the endpoints of
roughly a dozen outside edges: flows to the CRM, servings to the process
layer, assignments to nodes. **The hand-authoring a pattern removes is the
five wiring relationships, not the four elements.**

A generated part cannot hold any of that without a per-part override
syntax that would reintroduce the authoring the pattern exists to remove.

## Decision

**An instance binds the subjects that are its parts; the pattern owns the
wiring between them.**

```yaml
# the pattern, in a yarramate/pattern/v1 document
patterns:
  - kind: yarrasys/api-led@1.0#api
    parts:
      component: { kind: yarramate/core@0.1#applicationComponent, required: true }
      interface: { kind: yarramate/core@0.1#applicationInterface, required: true }
      service:   { kind: yarramate/core@0.1#applicationService }
    wiring:
      - { from: self,      kind: yarramate/core@0.1#aggregation, to: component }
      - { from: self,      kind: yarramate/core@0.1#aggregation, to: interface }
      - { from: self,      kind: yarramate/core@0.1#aggregation, to: service }
      - { from: component, kind: yarramate/core@0.1#composition, to: interface }
      - { from: interface, kind: yarramate/core@0.1#assignment,  to: service }
```

```yaml
# the instance, in an ordinary architecture document
- id: contact-system-api
  kind: api
  name: System API
  parts:
    component: contact-sys-api
    interface: contact-sys-api-interface
    service: salesforce-write-service
```

- **Binding, not generation.** A slot names a subject that exists.
  Parts keep their own identity: name, description, owner, evidence,
  attestations, and every outside edge they already carry. The pattern
  contributes the wiring, which is the part that was pure ceremony.
- **Expansion is compile-time and lands in the graph, never in a
  document.** Nothing writes YAML back. A pattern edited today re-wires
  every instance on the next compile, which is the property that makes
  this a compiler stage rather than scaffolding. `apply` is untouched:
  it still reads only what it is handed (ADR 0100).
- **Wiring ids are derived and stable**: the instance id, then the source
  slot where it is not `self`, then the relationship's core kind, then
  the target slot. `contact-system-api-aggregation-component`;
  `contact-system-api-component-composition-interface`. The triple
  (from, kind, to) is unique within an instance by construction, so the
  id is too. They are ordinary kebab ids in the one id space, because
  the subject-id grammar has no dots and widening it for generated
  subjects would change every schema and every consumer's regex for a
  cosmetic distinction.
- **A minted claim is `declared`, sourced to the binding that made it.**
  The claim "contact-system-api aggregates contact-sys-api" points at the
  `component: contact-sys-api` line in the architecture document, because
  that is where the author said it: the pattern contributes only which
  KIND of edge a bound pair gets. `origin` stays a closed vocabulary of
  one and `yarramate/graph/v2` does not move, which matters more than the
  bookkeeping it would buy: the interchange format is the most consumed
  artifact here, and widening its claim origin would make every pinned
  copy reject any graph containing a pattern. The expanded graph is
  therefore indistinguishable from a hand-authored one, which is the
  property that lets the Archi and LikeC4 exports see pure ArchiMate
  without learning what a pattern is.
- **Expansion is idempotent against authored wiring.** Where an authored
  relationship already has exactly the endpoints, kind and direction a
  wiring edge declares, the pattern mints nothing: the authored one
  satisfies the wiring. A model can therefore adopt a pattern without
  touching a line, and delete the redundant relationships afterwards at
  its own pace. Without this rule, adoption would double every wiring
  edge on the first compile.
- **The pattern owns a wired pair.** For a wiring edge resolving to
  endpoints `a → b` of kind `k`, any authored relationship between `a`
  and `b` that is not exactly `a → b` of kind `k` is a **compile error**
  (`YM418`): a reversed composition, a different kind, a second opinion
  about a pair the pattern has already spoken for. Outside edges are
  free — a part may serve, flow to, be assigned to and be accessed by
  anything at all. Only the pairs the wiring names are reserved.
- **Duplication is not an error, contradiction is.** Restating a wiring
  edge exactly is absorbed by the idempotence rule above and reported by
  nothing, because it says the same thing the pattern says.

### Diagnostics

| Code | Meaning |
| --- | --- |
| `YM315` | A `parts` slot names a subject that does not exist, or two slots of one instance name the same subject |
| `YM416` | A `required` part is not bound |
| `YM417` | A bound part is not of the kind its slot declares |
| `YM418` | An authored relationship contradicts the instance's wiring |
| `YM419` | `parts` is declared on a concept whose kind has no pattern |
| `YM420` | A derived wiring id collides with an authored subject id |

`YM315` joins the identity-and-reference band because an unbound
reference is what it is; the rest join profile conformance, because a
pattern is the shape a kind promises and these are the ways an instance
fails to keep it.

## Excluded options

- **Generating the parts** (the issue's own sketch). It is the larger
  authoring collapse and the wrong trade here: a generated part cannot
  carry the name, owner and evidence the fixture's parts already carry
  without a per-part override syntax, every existing hand-built cluster
  would have to be rewritten onto derived ids, and the derived ids would
  need a dot the grammar forbids or would collide with authored ones.
  Binding leaves the door open: a later phase can mint a part for an
  unbound required slot without changing anything decided here, because
  an instance that binds nothing is exactly the greenfield case.
- **`anchor: grouping` on the pattern.** The profile already says what
  the kind specializes; repeating it in the pattern gives two places to
  disagree. The pattern names the kind it shapes and reads the anchor
  from the resolved profile.
- **Warning rather than error on contradiction.** A contradiction nobody
  reads is exactly the drift #268 exists to end, and `check` would stop
  being the gate that makes the pattern a promise.
- **Making duplication an error too.** It would fail every model
  authored before its pattern existed, the contact-update fixture
  included, and it forbids nothing: an exact restatement cannot
  disagree with what it restates. The idempotence rule already stops it
  drawing twice.
- **Putting the pattern in the profile document.** A profile is
  vocabulary — what kinds exist and what they specialize. A pattern is
  structure. Keeping them apart lets a workspace give a shape to a kind
  it did not define, and keeps the profile schema from growing a second
  job. The cost is one more manifest category and one more published
  format.
- **Forbidding every internal edge not in the wiring.** Two parts may
  legitimately have a relationship the pattern does not describe, as
  long as it is not about a pair the wiring has claimed. The escape from
  a pair the pattern owns is to not wire that pair.

## Consequences

`yarramate/pattern/v1` is a new published format with its own schema and
Core contract entry, and the workspace manifest gains a `patterns`
category. (The manifest's existing `YM7xx` "pattern" diagnostics are
about path globs and keep that sense; the two meanings sit in different
documents and the word is the domain's.) A concept gains an optional
`parts` map, valid only on a kind that has one.

Every gate downstream gets the shape for free, which was the argument for
compiling rather than deriving: `check` validates the expanded graph
against the vendored 3.2 table, so an instance whose wiring is
semantically illegal fails on the ordinary rules rather than on a second
set; the LikeC4 and Archi exports see pure ArchiMate; `reconcile` can
attest a part and an instance separately; and the interview can ask at
both grains.

Phases 2 and 3 are untouched by this and still stand: ports and macro
edges, then the canvas fold. Phase 2's `ports` declaration lands on the
pattern beside `wiring`, and its expansion of a macro edge resolves
through the same slot names bound here.
