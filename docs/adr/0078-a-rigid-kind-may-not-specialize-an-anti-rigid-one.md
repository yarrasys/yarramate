# A rigid kind may not specialize an anti-rigid one

Status: accepted

The core profile has carried the actor/role distinction since ADR 0001:
`businessActor`, `businessRole`, and `businessCollaboration` are all separate
kinds. Nothing enforced the discipline behind them. A profile extension could
declare a team, a service, or a squad and parent it under `businessRole` with
no objection, and the resulting subjects then acquired owners, lifecycle
status, evidence, and attestations that belong to things rather than to
responsibilities. Every existing gate passed, because every existing gate
checks aspects, endpoints, references, and completeness, and none of them
looks at what a kind is for (#161).

Decided: a profile concept kind may declare one optional meta-property,
`rigidity`, with values `rigid` and `anti-rigid`, and the compiler enforces
the single rule that follows from it.

```yaml
conceptKinds:
  - id: microservice
    name: Microservice
    parent: yarramate/core@0.1#applicationComponent
    rigidity: rigid
```

The prior art is OntoClean (Guarino and Welty), which annotates properties
with meta-properties and derives mechanical constraints from them. A property
is rigid when it is essential to every instance and anti-rigid when it is
essential to none, and an anti-rigid property cannot subsume a rigid one:
Person is not a subclass of Student. The rule needs no world knowledge and no
prose. It compares two declared annotations across a lineage the compiler
already resolves.

## It is an error, not a hygiene question

The issue left this open, noting that YM404 aspect rules are errors and that
consistency argues for the same treatment. It does, and three further reasons
agree.

The diagnostic is about a profile document, and profile resolution has no
advisory severity to join. YM406 through YM412 are all errors, because a
profile that does not resolve cannot be used to compile anything. Inventing a
first advisory severity for this one rule would make it the odd case in its
own family, and it would put a profile-authoring defect in the same channel as
model-completeness questions, which are a different thing addressed to a
different person.

Hygiene exists in this codebase for questions the engine cannot decide. The
enrichment catalogue asks about missing linkage and unstated ownership because
absence is not error, and ADR 0054 keeps the engine out of prose entirely for
the same reason. This rule is decidable: two annotations, one lineage, no
judgment and no missing information. A check that can be right is not a matter
of taste.

Most of all, the error is opt-in and self-inflicted. It fires only when an
author has written `rigidity: rigid` on a kind whose ancestor someone has
written `rigidity: anti-rigid` on, which is a contradiction in declared terms:
this kind is one nothing can stop being, and it is a kind of thing nothing
essentially is. Nobody who has not asked for the check can be stopped by it,
and the repair is always available in the author's own file, either by
reparenting or by removing an annotation they chose to add. That is the safest
possible profile for a hard failure, and it is why the honest objection to
making a research method a build gate does not land here: OntoClean is not
being imposed, it is being offered.

## The whole lineage is checked, not the parent

Specialization is transitive, so subsumption is too, and an unannotated kind
between a rigid child and an anti-rigid ancestor does not launder anything.
The compiler walks the resolved parent lineage, which it already computes for
descendant kind matching, and reports the first anti-rigid ancestor it finds
by qualified identity, so the message names the kind that actually conflicts
rather than the intermediate one that does not.

An unannotated kind constrains nothing in either direction. It is not treated
as rigid by default, and it does not inherit anti-rigidity from a parent as an
effective value. Both would turn an opt-in annotation into a silent global
assertion about the entire vocabulary, which is exactly the change that would
have deserved a version bump.

## Core is annotated, on one side only, and does not bump

Annotating core was the other open question, and the case for doing it now is
that the alternative is a feature that cannot fire. Almost every extension
kind roots in core, so an unannotated core leaves the rule reachable only
inside a single profile that annotates both sides itself. Shipping the
machinery without the annotations would be shipping a rule that catches the
mistake nobody makes and misses the one the issue was filed about.

Five core kinds are annotated, all `anti-rigid`, and only where the
ArchiMate-inspired semantics answer the question without interpretation.
`businessRole` is a responsibility an actor is assigned and can be released
from, which is the entire reason it is a separate kind from `businessActor`.
`businessCollaboration`, `applicationCollaboration`, and
`technologyCollaboration` are aggregates formed to perform collective
behavior, and they stop existing when the collaborating stops.
`stakeholder` is defined as the role of an individual, team, or organization
with respect to one architecture, so it is a role by its own definition. Every
other core kind is left unannotated, including ones that feel rigid, because
"feels rigid" is the standard this change exists to avoid.

Core declares no `rigid` kinds at all, which is a deliberate asymmetry. Core
kinds are lineage roots, so no core kind can have an anti-rigid ancestor and
no `rigid` annotation on one could ever fire. Each would be a new semantic
claim about a stable vocabulary bought for exactly nothing.

The core profile identity stays `yarramate/core@0.1`. A bump is the larger
break by a wide margin: kind identity is written into every graph claim and
every projection selector in every existing workspace, so `0.2` would rewrite
all of them to label a change that rejects no input anyone can currently
author. The compatibility argument is checkable rather than asserted. The only
new rejection requires a `rigidity: rigid` annotation, the field did not exist
before this change, so no profile that validates today can trigger it, and the
annotation reaches no graph, no claim, and no projection.

It should still be said plainly that annotating core is an addition to what
core says about core vocabulary, which is not conservative in the sense of the
ontology-modularization criterion ADR 0079 cites. That is precisely why it is
done in core rather than smuggled in through a profile: a change to core is
allowed to change core, in the open, with a compatibility argument attached.

## What is deliberately left out

Identity and unity, OntoClean's other meta-properties, are out of scope. The
issue leaned that way and it is right: rigidity is the one with a mechanical,
checkable consequence, and the others would buy annotation burden and a
vocabulary discussion with no diagnostic at the end of it.

Relationship kinds take no annotation, and the schema rejects one. Rigidity is
a claim about what instances essentially are; endpoint aspect constraints
already govern what a relationship kind may connect.

Model-level `specialization` relationships between subjects are not checked,
and this is the interesting omission. The rule would arguably apply, since a
specialization relationship is a subsumption claim. It is left out because it
would break the opt-in property that justifies making this an error at all. A
model author would be stopped by an annotation written by whoever wrote their
profile, in a file they may not own, with the repair somewhere other than
where the error is reported, which ADR 0039 exists to prevent. The profile
layer keeps the error in front of the person who asked for it. If the
annotation earns adoption, the model-level rule can be revisited on its own
merits.

## Consequences

The profile layer gains its first meta-property and its first diagnostic that
is about meaning rather than structure, at a cost of one optional enum field
and one lineage walk during profile resolution. Nothing in the model-authoring
surface changes, no existing profile or document can newly fail, and no
compiled output moves.

What the project gains is a place to put a distinction it already made in its
vocabulary and could not previously defend. What it takes on is the obligation
to answer "why is this kind not annotated" for the rest of core, and the
correct answer, for now, is that an unannotated kind asserts nothing and that
silence is cheaper than a wrong annotation.
