# A rule can name its exception

Status: accepted

`Remove from view` and `Add to this view` (#255, shipped in #263) were
offered only where the active view named its subjects.
`activeViewMembership` answered `null` for a view that describes its
subjects with facets, and the whole View group left the menu. The reason
was recorded in the test: an item that could only ever do nothing is
worse than no item.

That reasoning is sound about adding, and it was never true about
removing. A facet view is precisely where a reviewer most wants to say
"not that one": `layers: [application]` is a rule, and every interesting
rule has an exception the author would rather state than abandon the rule
for. Measured on the contact-update journey, the group was absent on half
the authored views. The only ways out were to abandon the facet and
enumerate every subject by hand, or to leave the unwanted subject on the
canvas.

The alternative a diagramming tool offers is worse than either. In Archi
a removed element simply stops being in the view and the diagram never
records that anyone decided it.

## Decision

`yarramate/projection/v1` gains `query.exclude`, a list of subjects the
query would otherwise select and the author has taken out. The view stays
declarative, the rule goes on refreshing as the model grows, and the
exception is a reviewable line in Git rather than a silent absence.

- **An exclusion is final.** It is applied as a concept facet AND as an
  endpoint veto, so it survives everything that could put the subject
  back: `relationships: connected` adds the far end of every relationship
  it draws, and an exclusion applied only to the initial selection would
  let an excluded subject walk back in by the other end of a relationship
  to one that stayed. Relationships touching an excluded subject go with
  it, because a line drawn to something not on the canvas has nowhere to
  land. This is the same veto `excludeStatuses` already holds, and it is
  stated here for the same reason.
- **A relationship can be excluded by name.** `exclude` names subjects,
  and a relationship is a subject. Excluding one leaves both its ends
  drawn.
- **The exception outranks every rule as an explanation.** `exclude` is
  the first facet `droppedBy` checks, ahead of `states`. When someone has
  written a subject down as taken out, that is the first reason a reader
  would reach for, whatever else would also have dropped it. The query
  panel labels the facet "Taken out of this view" (#248).
- **An exclusion is a statement about the rule, not about today's match
  set.** Naming a subject no facet currently selects is allowed, and is
  simply inert until the model grows into the rule. This is what lets the
  menu offer the item without first knowing what the query matches, and
  it means an exception survives a model that has not caught up with it
  yet.
- **The menu is asymmetric on a faceted view, deliberately.** `Remove
  from view` names the subject in `exclude`. `Add to this view` is
  offered only to lift an exception the view already holds. Adding a
  subject the facets do not select would need an `include` tier, and
  writing it into `subjects` instead would quietly convert the rule into
  a list. So `withMembership` returns its usual `null` for that case, and
  the original reasoning still governs it: an item that could only ever
  do nothing is worse than no item.
- **The last exception takes the key with it.** Lifting the final
  exclusion rebuilds the query without an `exclude` key rather than
  leaving `exclude: []`, which says the same thing and which the schema's
  `minItems: 1` refuses anyway.
- **The tray reads the view, not the list.** `membershipDelta` reports a
  name arriving in `exclude` as `-id` and a name leaving it as `+id`,
  because the row says what happened to the view. On an enumerating view
  the two coincide; on a faceted one they are inverted, and reporting the
  list's own motion would tell the reviewer the opposite of what they
  did.

### The three questions the issue left open

**Does `exclude` belong in `yarramate/projection/v1`, and is adding it
breaking?** Yes, and no. It is an optional field on `query`, so every
existing projection is unchanged and still valid. The LikeC4 export needs
no work at all: it evaluates the query through `evaluateProjection` and
reads only `query.states` for itself, so it inherits exclusion with the
rest. The `presentation` round-trip is untouched, since this is a query
field. A consumer validating against a pinned pre-`exclude` copy of the
schema will reject a projection that uses one, the ordinary shape of an
additive schema change here. The one place that did need telling is
`SUBJECT_REFERENCE_POSITIONS`: `exclude` holds subject addresses, so a
rename has to move them, and the schema-derived completeness test is what
said so.

**Should the canvas mark an excluded subject when it is drawn anyway?**
The question does not arise, because it is never drawn anyway. The
endpoint veto above is what makes that true, and it is the reason the
veto is part of this decision rather than a refinement of it. A mark
would have been a second vocabulary for a state that cannot occur.

**Does `Add to this view` imply the full three-tier model?** No, and that
is the point of the asymmetry. `exclude` alone closes the half that is
expressible. A `query` / `include` / `exclude` model is a bigger decision
about what a view IS, and it is left to whoever meets a view that needs
it.

## Excluded options

- **The full three-tier `query` / `include` / `exclude` model.** It would
  answer "add a subject the facets do not select" as well, but a view
  that both states a rule and carries a hand-written addition is close to
  a list with extra steps, and nothing has asked for it yet. Recorded as
  the follow-up if a real view does.
- **Marking an excluded subject on the canvas.** Nothing to mark, as
  above.
- **Refusing an exclusion that no facet would have selected.** It would
  need the match set at the moment the menu is drawn, which the menu does
  not have, and it would make the exception a statement about the model
  as it stands today rather than about the rule.
- **Naming it `excludeSubjects`, beside `excludeStatuses`.** Parallel in
  spelling and wrong in meaning: `excludeStatuses` is a facet with its
  own selection semantics, while this is the veto over every facet.
  `exclude` reads as what it is, and sits beside `subjects` as its
  opposite.
- **Applying the exclusion only to concepts.** A view can be spoiled by
  one relationship as easily as by one subject, and `exclude` names
  subjects, which relationships are.

## Consequences

`ProjectionQuery` gains one optional field, the schema one property, and
`ConceptFacet` one member. `activeViewMembership` changes shape, from
`readonly string[] | null` to a union naming which kind of view it
describes; `null` now means only "no view is active", which is the
question it was always meant to answer. Nothing in the wire protocol
moves and no CLI verb changes.

The View group returns to the half of the authored views that lost it,
and it returns saying the truthful thing: on a rule, removing is stating
an exception, and adding is lifting one.
