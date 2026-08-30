# What a model states, and what it does not

This document is a contract rather than a description. It says which facts a
YarraMate model can hold, which it deliberately will not, and where the second
kind belongs instead.

It exists because the floor was never drawn. A search of the foundational
extension records (ADRs 0003, 0004, 0006, 0095, 0097) finds no consideration
of arbitrary properties or of ArchiMate's attribute mechanism, and
`docs/NATIVE-DOCUMENT.md` carries one deferral clause about *arbitrary*
properties and nothing more. An adopter probing the edges therefore finds them
one at a time, by building something and discovering it does not fit. Three
issues were filed in one week that a written floor would have turned into one
question or none (#379, #386, #388).

## The rule everything else follows from

**Every value in a native record is defined syntax that compiles to a claim.**
There is no generic metadata bag (ADR 0003), and there is no place to put a
fact the compiler does not understand. That is the whole of the discipline,
and everything below is a consequence of it.

## Where a fact lives

| The fact | Its home | Notes |
| --- | --- | --- |
| This thing exists | a concept | |
| These two things relate | a relationship | admissible pairs come from the ArchiMate table (ADR 0097) |
| This thing is *a kind of* thing | the concept's `kind` | specialize a profile kind with `parent:` |
| This thing is restricted this way | a **constraint subject**, referenced | one subject, referenced by many concepts |
| This thing belongs to that set | a **`grouping`** that aggregates it | the home for a classification the `kind` cannot carry |
| This thing cites that thing | `references[].ref` | resolves to a subject |
| Someone vouched for this | an `attestation` | records **who** and **when**, never **what** |
| Someone observed this | an evidence overlay | provider-owned, `evidence.uri` opaque to Core |
| This is true in that phase | `presentIn` | the **time** axis only: baseline, transition, target |

### A value that matters becomes a subject

This is the least obvious entry and the one adopters miss, so it is worth
stating outright. Where a value carries architectural weight, it is modelled
as a subject that other subjects point at, not as a property repeated on each
of them.

The shipped policy profile is the worked example. `core-enrichment` asks "what
is the default authentication mechanism for interactions in this
architecture?", and the answer is authored as an `authentication-constraint`
concept named for the mechanism:

```yaml
concepts:
  - id: oauth2
    kind: authentication-constraint
    name: OAuth2 client credentials
  - id: orders-api
    kind: applicationInterface
    name: Orders API
    constraints:
      - id: authn
        ref: oauth2
```

One subject holds the value; every interface that uses it points at the same
one. The value is checkable (the reference must resolve), queryable (the
`missing-constraint` condition asks about it), and shared rather than copied.
A closed vocabulary of five values becomes five subjects, not a string
repeated on twenty-seven interfaces.

### A classification is a grouping, not a constraint

The paragraph above is the home for a **restriction**: a rule the subject must
satisfy. A **classification** is a different fact and takes a different home,
and confusing the two is the first mistake an adopter makes here.

A subject's own classification is its `kind`. A second axis, which `kind`
cannot carry because a concept has exactly one, is a `grouping` that
aggregates its members:

```yaml
concepts:
  - id: experience-layer
    kind: grouping
    name: Experience layer
relationships:
  - id: experience-layer-holds-ocrf
    kind: aggregation
    from: experience-layer
    to: ocrf-experience-api
```

Aggregation from a `grouping` is permitted to every element kind, so this
works wherever the classification applies.

Two alternatives look right and are not:

*A note on reaching them.* A referenced subject is **not** a one-hop
neighbour: `relationships: connected` walks relationships, so `ask <subject>`
and every projection using `connected` leave it out of the slice (#409). It is
still named in a brief — "Constrained by …" — so it is discoverable and can be
addressed directly by id; it is named rather than expanded. Worth knowing
before building a view or a slice that is meant to show a subject together
with the values restricting it.

- **A constraint subject.** It reads as "this thing is restricted this way",
  and an API layer or an integration style restricts nothing. An ArchiMate
  reader will notice.
- **Specializing a same-type classifier**, so that twenty-seven services
  specialize an `applicationService` named "Experience API". This is
  canonical ArchiMate and the relationship table permits it, but **a
  same-type classifier is itself an interrogation subject.** The shipped
  catalogue names `applicationService` in eighteen selector positions and
  `applicationInterface` in seventeen, so each classifier attracts the whole
  question set for its type, and a change that closes forty-seven cards can
  open sixty. `grouping` is named in **no** selector in the shipped
  catalogue, so a grouping attracts none.

A question about a classification therefore closes on `missing-linkage`,
asking for an incoming aggregation from a grouping, which records the answer
rather than the fact that someone answered.

## What the model does not hold

These are refusals, not gaps awaiting a feature. Each names where the fact
belongs instead.

### A second, orthogonal classification

A concept has exactly one `kind`. One classification axis is therefore free,
and a second is not: an interface classified by both interaction style and
trigger category cannot express both as kinds without declaring their cross
product. Where a second axis carries weight, model it as a `grouping` that
aggregates its members, per "a classification is a grouping" above. Where it
does not, it belongs in an annex.

### A per-instance free value

An endpoint's path, an operation verb, a tuning number. Nothing holds these
but `description`, and description prose is opaque to Core by design: it is
narrative, never queried, never validated. A fact you need a machine to read
back is not a description.

### Ordered detail beneath a subject

A model holds subjects and edges. It does not hold rows under a subject:
processor sequences, message samples, field-level mappings, entity attribute
tables. Modelling them as concepts is technically possible and is a mistake,
because **every concept is an interrogation subject**, so a hundred rows of
implementation detail become a hundred subjects a selector matches and the
architecture interview becomes unusable.

### An environment axis

`presentIn` is time, not place: baseline, transition, target. A deployment
topology per environment has no axis, and the closest available expression
(marking a production node `status: planned`) states something the author does
not mean.

### Configuration and tuning

Replica counts, heap and vCore sizes, secret store names, host and port.
**These change without the architecture changing, which is the test**, and
the test rather than the list is what decides.

A committed threshold is on the other side of it. "This interface must
sustain 200 transactions per second, bursting to 500" is not tuning: it is a
restriction the design has to satisfy, it survives every capacity change made
to meet it, and it belongs as a constraint subject. The capacity settings
chosen to meet it do not. The same register commonly carries both, one column
apart, and they are different facts.

## The rule a catalogue must obey

**Whatever the interrogation asks about must be recordable as an answer.**

A model may decline to hold processor steps precisely because nothing asks
about them. It may not decline a fact its own catalogue asks for by name and
then calls answered. Depth is a modelling choice; a question whose answer has
nowhere to go is a defect at any depth.

The sharp case is `missing-attestation`. It closes on
`yarramate/attestation/<topic>`, a claim that records **who** vouched and
**when**, and by construction carries no value. That is exactly right for a
question of the form *"has this been reviewed?"*. The shipped catalogue's two
attestation questions both ask that, and who-and-when is the whole answer.

It is exactly wrong for a question of the form *"what is the deployment
model?"*. Closing it records that a confirmation happened and discards what
was confirmed. The card reads worked, the substance is gone, and nothing
anywhere reports a problem. A question whose answer is a value must be asked
with a condition that closes on that value's home: `missing-constraint` where
the value is a restriction, `missing-relationship` or `missing-linkage` where
it is structural, `no-subject-of-kind` where it is a vocabulary the workspace
should declare.

Read the question text back before choosing a condition. If it begins "what"
or "which", `missing-attestation` is the wrong close.

## Where the rest belongs

Facts this model declines are not homeless. They belong in a host document
alongside the workspace, joined to the model by subject id.

Such a document is not declared in the workspace manifest, which selects
compiler inputs rather than inventorying a directory. To make it discoverable
from the model, record it as an evidence observation under a provider of your
own naming, with an opaque `evidence.uri` the host resolves:

```yaml
format: yarramate/evidence/v1
provider: acme-lld
observations:
  - subject: order-flow
    result: confirmed
    key: processors
    evidence:
      uri: acme:annex/order-flow.processors.yaml
```

`yarramate ask <workspace.yaml> --where order-flow --json` then returns that
locator against the subject, with the provider named. Core never resolves,
fetches, or interprets the URI: URI ownership is the provider's (ADR 0068,
`docs/EVIDENCE.md`).

**So no condition can ask about what is inside it, and that is the design
rather than a gap.** An annex is not compiled, so nothing about its contents
reaches the graph the interrogation runs over. A catalogue therefore cannot
ask "are the field mappings recorded"; it can only ask **who confirmed that
they are**, which is what `missing-attestation` is for. An attestation names a
person and a date, and where the substance lives outside the graph that is the
only honest instrument left — a condition claiming to check annex contents
would be claiming to check something Core never read.

This is the adopter-facing half of CONTRIBUTING.md's fifth rule, arrived at
from the other side. There a check could not see what a declaration compiles
to, by accident. Here it cannot see what was deliberately never compiled, by
design. Same reach limit, opposite cause, and the remedies differ: that one is
fixed by reading the graph instead of the vocabulary, and this one is not
fixed at all, because there is nothing to read.

### The model points at the external document, not the reverse

The observation above is what makes an annex reachable, and **the direction of
the join is load-bearing.** The model names the document. The document does
not name the model.

Inverting it works, and it costs a check. A host document that declares which
subject it specifies needs nothing from YarraMate, and it keeps the pointer
beside the thing that changes, which is a real argument. But nothing YarraMate
reads can then see the link, so a subject whose annex was never written is
indistinguishable from one that was never meant to have an annex, and a
document naming a subject that does not exist is never refused.

Pointed outward, both cases are already reported, without resolving or opening
anything:

- `reconcile` lists `unobservedSubjects`, every current concept no observation
  covers (ADR 0049). A subject whose annex is missing appears there by
  construction.
- A manifest `coverage` scope makes the mirror case visible: an artifact in
  scope that no observation claims is listed under `unclaimedArtifacts`
  (ADR 0130), compared as strings against `repo:<path>` locators.

That is the whole of what a model-side check can offer here, and it is worth
stating as a limit rather than leaving to be discovered: **the pointer's
presence is checkable; its target's contents are not.**

A locator carried on the subject itself would buy nothing beyond what the
observation already gives, and it would be a second reference system that
resolves nothing. That is why none of the compiled mechanisms takes one, and
each refusal is narrow and correct on its own terms: `references[].ref`
resolves a workspace-global subject id, `constraints[].expects` is an
exact-match producer tuple, and `name`, `description` and `aka` are prose Core
never queries. The opaque locator is real and it is the one on the
observation.

## Examined and declined

The refusals above are recorded limits. Three of them were open questions,
and all three closed the same way: measured against a real model rather than
argued, costed, and found to serve too little to be worth what they cost.

**Declared reference slots (#388), so that what a citation is *for* could be
checked and asked about. Not built.** A reference's authored id is still
semantically discarded: `references: [{id: source-of-truth, ref: x}]` and
`{id: schema-ref, ref: x}` compile to the same predicate and object, so a
catalogue can ask "this subject has no references" and never "this mapping
names no source of truth". That cost is real and it stands.

What it would have cost more. A declared slot has to reach the graph one of
two ways, and neither is free. Emitting **only** the profile predicate keeps
one fact in one place and breaks every reader of
`yarramate/reference/refers-to` for models that opt in — four reader sites
across three modules here, plus any graph v2 consumer, and that contract is
published in `docs/NATIVE-DOCUMENT.md` and `docs/SEMANTIC-GRAPH.md`, which
ship in the package. Emitting **both** keeps every reader whole and gives one
authored fact two addressable claim ids; evidence targets claims by id, so an
observation can attach to the one nothing reads, validate cleanly, and mean
nothing. That is a silent wrong answer, which is the shape this design refuses
wherever it finds it.

**Whether an attestation can confirm a declared value rather than only a topic
(#397). Not built**, and the catalogue-author's remedy is the one this
document already gives: ask value questions with a condition that closes on
the value's home — `missing-constraint`, `missing-relationship`,
`missing-linkage`, `no-subject-of-kind` — and reserve `missing-attestation`
for who-and-when questions, where `by` and `on` are the whole answer. Its one
shape that needed no new value types was #388's slot in another position, so
it closed with it.

The measurement is the reason, not the argument. Two of the shipped
catalogue's 75 conditions are `missing-attestation`, and both ask whether an
accountable reviewer accepted something, where who-and-when *is* the answer.
An adopter whose own catalogue was 14 of 25 re-authored on this document's
basis and found **one genuinely homeless card in 348**.

Reopen either with an adopter measuring a materially larger residue against
this document. That is the specific evidence that would change the answer, and
it is the same test that closed #386.

**A general typed-attribute mechanism was examined and declined (#386).** It
would have given the second classification axis and the per-instance value a
checkable home, and the measurement went against it: run against a live
adopter engagement of 348 open cards, this document failed to resolve **one**,
and that card asked a delivery question in an architecture question's clothes.
Two corrections from the same measurement are worth carrying, because they
outlive the decision. An attribute is **single-valued**, so it never rescues
ordered detail — sixty-eight processor steps are rows, not sixty-eight
attributes of a flow. And the useful split is **three-way**, not two:
attribute, attestation, annex, where a fact needing a named human to vouch for
it is an attestation and not an attribute of anything.

Nothing here is a promise that they stay refused. It is a statement of what is
true today, written so that the next adopter reads the floor instead of
finding it.
