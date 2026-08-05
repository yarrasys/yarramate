# An alias is matchable, never renderable

Status: accepted

From the ontology-mapping exploration (2026-08-05, issue #160): a concept
carried exactly one name. Real vocabularies do not. A subject has an
abbreviation, a legacy name, a project codename, and whatever the team
actually says in standup, and the model had nowhere to put any of it. The
gap paid twice. Free-text seeding in `ask` matched ids, names, and
descriptions, so a user typing the team's own word for a subject got
nothing back and fell through to the roster. Near-duplicate detection
(ADR 0077) lost its single strongest signal, because a genuine duplicate
very often reuses the other subject's alias.

Prior art is SKOS, which separates preferred, alternative, and hidden
labels precisely because synonyms are the normal case rather than the
exception.

Decided: an optional `aka` list on concepts, compiled to one
`yarramate/concept/alias` value claim per entry.

**No structural change to graph v2.** The compatibility rules are explicit
that new source-language features may emit additional claims using the
existing v2 claim structure, and that consumers must interpret predicates
by identity and ignore predicates they do not understand. An alias is an
ordinary value claim in the ordinary envelope: no new field, no new
object shape, no new required structure. A renderer written before this
ADR reads a model containing aliases correctly, and reads the preferred
name, because the preferred name is still the only
`yarramate/concept/name` claim.

**Claim identity derives from the alias text, not its position.** The
claim id is `<subject>~alias-<hex of the alias>`, the same trick presence
claims use for their state identity. Aliases are an unordered set with no
authored ids, so an index-based id would churn every downstream claim
identity when somebody inserts a new alias at the top of the list.
Content-derived ids make reordering the YAML a byte-identical no-op in the
canonical graph. Uniqueness is guaranteed by the schema, which requires
`uniqueItems`.

**Aliases match at the same weight as the name.** Seeding builds one flat
haystack per concept from the id, the name, the aliases, and the
description, and scores how many query terms appear in it. Nothing in that
match is graded today, and introducing a weight for exactly one field
would make aliases the single graded input to an otherwise ungraded
score. It would also defeat the point: the reason to record that a
component is called "OG" is so that typing "OG" finds it. Ranking the
alias below the name would deliver a worse answer than the one the author
explicitly asked for.

**Briefs and every other renderer keep printing the preferred name only.**
An alias is an index entry, not a display string. Rendering a subject as
"Order Gateway (OG, the gateway, order-gw)" would spend context budget on
lookup keys and put four names for one thing in front of a reader whose
whole problem is that there are too many names for one thing.

**Hidden labels are rejected for v1.** SKOS distinguishes alternative
labels from hidden ones, the latter being matchable but never shown, for
deprecated or misspelled forms. Since no YarraMate renderer shows aliases
at all, `aka` already behaves exactly like a hidden label, and the
distinction would buy nothing but a second field to explain. If a
renderer later earns the right to display alternative labels, splitting
the list then is additive; collapsing two lists into one afterwards would
not be.

**Concepts only, not relationships.** Relationships are addressed by their
endpoints and their kind, `ask` indexes concepts alone for seeding, and
attestations already established that judgment-bearing and identity-bearing
records are subject-scoped. Widening to relationships later is additive.

**An alias colliding with another subject's name or id is allowed, and is
deliberately not its own diagnostic.** Making it an error would be wrong
on the facts: two teams legitimately use one word for two different
things, and no profile can know which case it is looking at. Making it a
separate hygiene question would duplicate work, because a collision of
that kind scores a perfect lexical match between two subjects of the same
kind, which is exactly the condition ADR 0077 opens the near-duplicate
question on. The collision case is therefore already answered, by
construction, through the mechanism built to answer it, and the answer
path is the same one every other near-duplicate gets.
