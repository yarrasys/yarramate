# An unselected profile changes nothing; an extension document is no worse

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

Decided: the properties are stated in `docs/PROFILES.md` and defended by
property tests, not by a mechanical check. There are two of them, and the
first published version of this decision had them fused into one statement
that was false; see "One statement was two" below.

> **A vocabulary nobody selects changes nothing.**
>
> Let `W` be a workspace and let `P` be one or more profile documents that no
> document in `W` selects. Then every diagnostic, catalogue evaluation, and
> projection result over `W + P` is byte-identical to the one over `W`.

> **An extension document is never a worse neighbour than its core twin.**
>
> Let `D` be a document that selects a kind declared in `P`, and let the
> **core twin** of `D` be `D` rewritten to declare the same subjects under the
> nearest core ancestor of each kind it uses. Then for every subject already
> present in `W`, every verdict change caused by adding `D` is also caused by
> adding the core twin. The converse does not hold: the core twin may change
> more.

Amended after publication (#172). One statement covered both the profile and
the documents that select it, and in that form it was false: adding any
document changes what a workspace-scoped catalogue asks about the subjects
already there, whether or not a profile is involved. The correction is below
under "One statement was two".

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

## One statement was two

The retracted wording, published as this decision's title and its single
property, was "Loading a profile extension adds subjects. It never changes
verdicts", quantified over "an extension: one or more profile documents that
no document in `W` selects, together with any documents that select them".

Bundling those two things is what made it false. Measured on the bundled
catalogue: an extension document declaring `orders` with a realization to a
pre-existing goal resolves that goal's `goal-unrealized` question - a verdict
change about a subject that was already there. Nothing profile-specific
happened, and the same document written in plain core does the same thing. The
published phrasing called that a violation, so it condemned the feature
instead of naming the fault.

So the statement splits along the join. A profile nobody selects is the
degenerate case and can be held to output identity. A document that selects an
extension kind is a document, and documents change their neighbours' verdicts;
the question an importer needs answered is whether routing one through an
extension profile exposes the workspace to more than plain modelling would. It
does not, and the answer is stronger than parity: the changes the extension
route causes about pre-existing subjects are a subset of the changes its core
twin causes. The near-duplicate check is where that gap is measurable, because
it buckets by exact kind (ADR 0077): an arrival under an extension kind leaves
closed a question the same arrival in plain core opens.

## Documentation and a property test, not a proof

The issue leaned this way and the reasoning holds. A general mechanical check
would have to quantify over every future feature, which is a proof obligation
on a codebase, not a test. What exists instead is a seven-case test. Five hold
the first property, compiling a core-only workspace with and without an
unrelated extension and asserting byte identity across the graph, the
diagnostics, the catalogue evaluation, and a descendant-matching projection,
plus a case that asserts the widening happens and that every arrival is a
subject the extension document introduced. Two hold the second by control
rather than by assertion, running the same arrival through an extension kind
and through its core twin: an equality witness, where both routes resolve the
same question about a pre-existing subject, and a strictness witness, where
only the core twin opens a near-duplicate question about one.

The degenerate case is what makes the first property testable at all. When `P`
is loaded but never selected it adds no subjects, so "changes nothing"
collapses to exact output identity and a string comparison settles it. The
second property has no degenerate case, which is why it is measured against a
twin rather than against the empty change.

It is worth recording why the first property holds today, because that is the
list a future feature has to keep true. Profile resolution is additive by
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

The first property constrains the roadmap, which is most of its value. Any
future profile feature that lets an extension restate, re-parent, re-annotate,
or constrain a kind it did not declare violates it, and now has to be argued
for against a written statement rather than discovered afterwards by whoever
imported the profile. Overrides, deprecations of core kinds from an extension,
and extension-supplied constraints on core kinds are all in that category.

The second constrains a subtler class. Any surface that treats an extension
kind as a wider participant than the core kind it specializes breaks it
without touching profile resolution at all: descendant bucketing in the
near-duplicate check would do exactly that, and a catalogue condition
resolving counterparts through lineage where the selector does not would be
the same fault elsewhere.

The costs are stated plainly. The first property's test can only ever check
the degenerate case, and it checks the four surfaces named here on one
fixture; it would not catch a breach in a surface added later that nobody
thought to include. The second property's two witnesses are controls on one
fixture pair, with the core twin written out by hand, so they demonstrate the
subset direction rather than establish it. The statements are what the tests
are measured against, not the reverse.
