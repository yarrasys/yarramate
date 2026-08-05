# A profile extension adds subjects, never verdicts

Status: accepted

Profiles are the extension point YarraMate offers, and extension kinds
specialize core kinds: the project's own development profile does exactly
that. The property that makes importing one safe was never written down and
never tested. Users were being asked to trust a modularization guarantee
nobody had stated (#163).

The prior art is the standard criterion: a module is a conservative extension
of an ontology when it adds nothing about the original vocabulary. Everything
the base said about base terms still holds, nothing new about base terms
becomes derivable, and that is what lets someone import a module without
auditing it.

Decided: the property is stated in `docs/PROFILES.md` and defended by a
property test, not by a mechanical check.

> **Loading a profile extension adds subjects. It never changes verdicts.**
>
> Let `W` be a workspace and let `E` be an extension: one or more profile
> documents that no document in `W` selects, together with any documents that
> select them. Then for every subject present in `W`, every diagnostic,
> catalogue evaluation, and projection result concerning that subject is the
> same in `W` and in `W + E`. Loading `E` may add outcomes concerning the
> subjects `E` itself introduces. It may change no outcome concerning a
> subject that was already there.

## The phrasing is the work

The obvious statement, and the one the issue starts from, is that a query
about core kinds returns the same answer with and without an extension
loaded. It is false, and it is false by design. A core-kind selector with
`kindMatching: descendants` returns more subjects once an extension exists.
`yarramate/core@0.1#applicationComponent` matches an extension's
`microservice`, which is precisely what ADR 0029 built descendant matching to
do, and catalogue conditions resolve through lineage by default for the same
reason (ADR 0063). A property that forbade this would not be catching a bug,
it would be describing a different product.

So the quantifier had to move. The property ranges over subjects, not over
queries. Every extra match is a subject the extension brought with it, and
about every subject that was already there the answer is unchanged: same
kind, same status, same lineage, same claims, same diagnosis, same membership
in the same projections. An extension may enlarge the domain. It may not
revise the domain it enlarged.

That is also the faithful reading of the original criterion rather than a
weakening of it. Conservativity says the base theory gains no new consequences
about base vocabulary. A new individual answering to a base predicate is not a
new consequence about the base; it is a new individual. The naive phrasing
conflated the vocabulary with the population, and the model is the population.

## Documentation and a property test, not a proof

The issue leaned this way and the reasoning holds. A general mechanical check
would have to quantify over every future feature, which is a proof obligation
on a codebase, not a test. What exists instead is a five-case test that
compiles a core-only workspace with and without an unrelated extension and
asserts byte identity across the graph, the diagnostics, the catalogue
evaluation, and a descendant-matching projection, plus a fifth case that
asserts the widening happens and that every arrival is a subject the extension
document introduced.

The degenerate case is what makes this testable at all. When `E` introduces no
documents, a profile loaded but never selected, it adds no subjects, so "no
verdict changes" collapses to exact output identity and a string comparison
settles it.

It is worth recording why the property holds today, because that is the list a
future feature has to keep true. Profile resolution is additive by
construction: an extension may only introduce new local names, since YM409 and
YM410 reject shadowing an inherited one, and may only narrow endpoint
constraints, since YM412 rejects broadening. It cannot reach a resolved core
kind. Document diagnostics are computed against the profile the document
selects, so a core-only document never has extension kinds in its resolved
map. Profile source files mint no subjects and no claims. And `graph.profiles`
derives from the profiles documents actually select, so an unselected profile
leaves no trace.

One place deserves naming because it is where a breach would most plausibly
hide. The YM404 endpoint diagnostic enumerates the relationship kinds that
would have worked, and that list is drawn from the selected profile rather
than from every resolved kind. If it were ever drawn from the global map, a
core-only workspace would start receiving repair advice naming kinds from an
extension it does not use, and the property would be broken by a helpful
message. The test asserts the message text, so that specific regression is
caught.

## Whether the rigidity work is conservative

The issue asked, and the two answers differ.

For extensions, yes. A profile may annotate only kinds it declares, since
there is no syntax for annotating an inherited one, and the annotation is
checked during profile resolution and then discarded before any graph, claim,
or projection. An extension carrying rigidity annotations changes nothing
about core.

For core annotating core, no, and it should be said plainly rather than argued
around. ADR 0078 adds `anti-rigid` to five core kinds, which is a new fact
about core vocabulary and therefore not a conservative extension in the sense
stated above. Calling it conservative because it happens to reject no
currently-authorable input would be confusing compatibility with
conservativity: it is backward compatible, and it is not conservative.

That distinction is the useful one, and it is why the property is worth
stating. Core is allowed to change core. Extensions are not. The rigidity
annotations went into the core profile, in the open, with their own
compatibility argument attached, instead of arriving through a profile that
quietly redefined kinds it did not own. A rule that made both routes look
equally acceptable would be a rule worth nothing.

## Consequences

The property constrains the roadmap, which is most of its value. Any future
profile feature that lets an extension restate, re-parent, re-annotate, or
constrain a kind it did not declare violates it, and now has to be argued for
against a written statement rather than discovered afterwards by whoever
imported the profile. Overrides, deprecations of core kinds from an extension,
and extension-supplied constraints on core kinds are all in that category.

The cost is a test that can only ever check the degenerate case, and the
honest limit is that it checks the four surfaces named here on one fixture. It
would not catch a breach in a surface added later that nobody thought to
include. The statement is what the test is measured against, not the reverse.
