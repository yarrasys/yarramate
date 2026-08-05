# Cardinality is the shape of a succession

Status: accepted

From the ontology-mapping exploration (2026-08-05, issue #162): the write
surface covers assert, enrich, retract, retire, and delete, which is a
subject's own lifecycle handled completely. What none of it can express is
a subject becoming other subjects. When a service splits in two, the model
records one retirement and two arrivals with nothing connecting them. When
two components merge, the same in reverse. The refactoring that motivated
the change is invisible a month later, and so is the answer to "where did
this go?", which is the question a newcomer actually asks.

Prior art is diachronic identity, the studied problem of what makes an
entity the same entity across change. The practical answer in modelling
systems is not inference. Nothing in two documents distinguishes a rename
from a coincidence of naming, so the succession is recorded or it is lost.

Decided: an optional `supersedes` list of subject references on concepts,
compiled to `yarramate/lineage/supersedes` reference claims.

## One predicate, not three

Rename, split, and merge are one-to-one, one-to-many, and many-to-one over
the same relation, so the obvious alternative was three predicates naming
the three cases. It is worse, and not only because it is more vocabulary.

**The shape is a global fact and the edit is local.** A subject that writes
`splitFrom` is asserting that its predecessor went to more than one place,
which it cannot see from inside its own document. The assertion also rots:
delete one of two successors a year later and the survivor still claims it
came from a split, which is now simply false. One predicate has no such
failure mode, because nothing is asserted about cardinality. The shape is
recomputed from whatever claims exist at the time somebody asks.

**Three predicates need the derivation anyway.** To catch the rotted claim
above, the compiler would have to count successors per predecessor and
compare that count against the authored label. That is the cardinality
derivation, plus a consistency check the one-predicate design does not need
because it has nothing to be inconsistent with. Strictly more machinery for
strictly less truth.

**The set is not closed.** A subject that absorbs half of one predecessor
and the whole of another is neither a split nor a merge, and arguing about
which of three names it deserves is an argument the model should not host.
Under one predicate it is two claims and the argument does not arise.

**The cost to a reader is a group-by.** Every graph-v2 consumer already
indexes claims by predicate, because that is the entire documented reading
algorithm. Grouping one predicate's claims by object is the same work as
learning three predicates, done once, by machine.

## The claim points backwards

`supersedes` lives on the successor and names the predecessor, rather than
a `succeededBy` on the predecessor naming what replaced it. Both directions
carry identical information, so the choice is about authoring and about
precedent.

**The authoring moment is the arrival of the new subject.** That is when
somebody knows the succession, and at that moment they are editing the new
subject. Pointing backwards means the new subject arrives complete, in one
document, saying what it is and where it came from. Pointing forwards means
reaching into the predecessor's document to add a field, and the
predecessor frequently lives in a document owned by another team, or in one
this change had no other reason to touch.

**The engine already points backwards for ordering.** `yarramate/state/after`
names the predecessor state, not the successor. Succession is the
subject-level analogue of state ordering, and using the opposite direction
for the same shape of fact would be a second idiom for no gain.

**Reading the other direction is free.** "Where did X go?" is a scan for
claims whose object is X, which any consumer holding the claim list can do.
The brief does exactly this and renders both directions from one claim set,
so the authoring convenience costs the reader nothing.

## Asymmetric, unlike a dismissal

ADR 0077 read `distinctFrom` symmetrically, and this deliberately does not.
The reasoning there was that the *pair* is what the judgment is about, so
demanding the same fact in two documents would be busywork with a failure
mode, since half a dismissal is no dismissal.

Succession is an ordered fact about time. The direction is the content, not
an artifact of which document happened to record it. Reading it
symmetrically would assert that the predecessor also succeeded its own
successor, which is the cycle this ADR spends a diagnostic rejecting.

## Referential integrity

`YM312` reports an unresolved succession reference and `YM313` a subject
declared to supersede itself, mirroring `YM310` and `YM311` exactly. The
targets must resolve for the same reason `owner`, `constraints`, and
`references` targets must: a lineage pointing at nothing is worse than no
lineage, because it looks like an answer.

`YM504` reports a succession cycle, mirroring `YM502` for cyclic state
ordering. A cycle asserts that a subject is its own ancestor. It is
tempting to read a two-step cycle as "we split it and then changed our
mind", but the model has no time axis: both ends of the cycle are one
snapshot, so what is actually recorded is that one subject both preceded
and followed another, which cannot be true of a single pair.

**Self-succession keeps its own code even though it is a cycle of length
one.** It is the case that actually happens, being a copy-paste inside a
single concept, and it deserves a diagnostic that says so rather than one
about participating in a cycle. The cycle walk skips self-references, so
exactly one diagnostic fires per defect and neither code doubles up on the
other.

## A superseded subject is not required to be retired

Enforcement was considered and rejected.

**The transition period is real.** A strangler migration runs the old thing
and the new thing side by side for months, and during that window the
predecessor is genuinely `current`. Requiring retirement would force the
model to misstate reality in exactly the period where the model earns its
keep, which is when two things are doing one job and somebody needs to know
which.

**Succession is often recorded before anything is retired at all.** The
split is designed, then built, then cut over. Both subjects can legitimately
be `planned`. A rule that fires at compile time cannot tell a plan from a
lie about the present.

**Retirement is its own decision with its own verb.** ADR 0064 made retired
a closed question and the write surface gave it a dedicated verb, precisely
so that descoping is a decision somebody takes rather than a side effect.
Coupling would turn succession into a back door that forces a lifecycle
transition nobody asked for.

**A rule here would be a claim about the future.** "The predecessor will
eventually be retired" is not checkable against a snapshot, and the engine
does not assert things it cannot check.

What the pairing buys is a reading rather than a rule. A retired subject
with a successor is materially different from one retired into nothing, and
the brief now says which, which was the point.

## No catalogue question about retired subjects with no successor

The issue floated this as a cheap follow-on. It is not cheap, and the
reason is worth recording so it is not proposed again as an oversight.

Retired concepts are excluded from the interrogation index outright, under
ADR 0064: retirement is the recorded decision that a subject left the
design conversation, so no question stays open against it. Asking anything
at all about a retired subject means carving an exception into that
exclusion, and the exception is not obviously containable, since the index
is shared by every question in the catalogue.

The second problem is worse. The honest answer is very often "nowhere, it
was decommissioned", and a question that cannot accept its own commonest
answer reopens on every run forever, which is the exact failure ADR 0077
built the dismissal mechanism to prevent. `distinctFrom` cannot be reused,
since its arity is binary and its meaning is wrong. Attestations do fit,
being unary and keyed by a kebab-case topic that needs to carry no subject
id, so if this is ever built the shape is a `decommissioned` attestation
topic and not a new mechanism. Naming the shape is what this ADR owes the
next person; building it is not in this change.

## What renders it, and what does not

**The brief renders lineage in both directions.** `supportSentences`
already renders ownership and constraints alongside a subject's
relationships, and succession joins them: "Succeeds X." on the successor,
"Superseded by Y." on the predecessor, both derived from the same claims.
This is the surface that answers "where did this go?", and it is the
surface a newcomer reads, so it is the one place the feature is not
optional.

**Slices are not expanded to pull in predecessors.** Seeded slices cap
their neighbourhood honestly (ADR 0070), and a succession edge would spend
that cap on history at the expense of the current neighbourhood the slice
was asked for. A brief that already names the predecessor gives a reader
the id to seed a second slice on, which is the honest version of the same
affordance.

**The traceability matrix is not touched.** The RTM answers what covers a
requirement now, and succession is a claim about the past; joining them
widens what the artifact claims from current coverage to coverage history,
which is a different artifact and deserves its own decision. The claims are
in graph v2, so a later RTM revision joins realizers to their predecessors
with a single predicate lookup and no new vocabulary. Shipping the
vocabulary before the rendering is the order ADR 0076 used for aliases,
which to this day no renderer displays.

**Concepts only, not relationships.** Relationships are addressed by their
endpoints and their kind, so a relationship whose endpoints are both
superseded has a succession that is already derivable. This follows ADR
0076 and widening later stays additive.

## No structural change to graph v2

A succession is an ordinary reference claim in the ordinary envelope: no
new field, no new object shape, no new required structure. The
compatibility rules are explicit that new source-language features may emit
additional claims using the existing v2 claim structure, and that consumers
must interpret predicates by identity and ignore predicates they do not
understand. A renderer written before this ADR reads a model containing
succession correctly, and simply does not mention it.

Claim identity is `<subject>~supersedes-<hex of the predecessor id>`,
content-derived the way alias and presence claims are, so reordering the
YAML leaves the canonical graph byte-identical. Uniqueness is guaranteed by
the schema, which requires `uniqueItems`.

## What it said about our own model

The 0.7.0 clean break to seven verbs (ADR 0061) retired ten command
services in one commit and recorded the old-to-new mapping only in a
migration table in `docs/AGENT-INTERFACE.md`. The model itself held ten
retirements and no connections, which is precisely the loss this ADR
describes, in this repository, for the past four days.

Nine succession claims now record it, and all three shapes appear without
any of them being named:

- a **merge**, where `ask-command` names five predecessors: `status`,
  `context`, `next`, `compare`, and `interrogate`;
- a **split**, where `interrogate-command` is named by two successors,
  `ask-command` taking the reporting half and `design-command` the
  interview half;
- a **rename**, where `export-command` names `compile-command` alone,
  after ADR 0060 reframed the artifact as an export;
- a second merge, where `apply-command` names `add-command` and
  `connect-command`, collapsed into one atomic batch by ADR 0057.

The brief now answers the motivating question directly. Seeding a slice on
the dead subject returns "Superseded by "yarramate-engine#ask-command" and
"yarramate-engine#design-command"", naming successors that the slice does
not contain, by the ids a reader can seed on next.

Two subjects were deliberately left with no successor, which matters more
than the nine that got one. `new-command` was retired because ADR 0061
decided that `new projection` gets no replacement at all: projections are
authored directly and validated by `check`. `evidence-command` left the
public surface without a specific successor, its machinery surviving inside
`check` and `reconcile`. Inventing a destination for either would have been
the model telling a story the ADRs do not support, and both are the reason
this change ships no question demanding one.
