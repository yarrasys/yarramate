# LikeC4 projects compose projections as views

A versioned adapter-owned project definition composes multiple semantic
projections into one derived LikeC4 logical model with one view per projection.
Each view uses explicit mapped concept predicates, excludes the union model's
inferred relationships, then includes projected relationships by their native
identity. Both node and edge membership therefore survive composition;
`include *` is valid only before models are unioned and must not leak the whole
project into every view.
The adapter unions mapped subjects before rendering rather than merging
independently generated model files, which avoids duplicate declarations while
keeping projection queries independent and native YarraMate documents
canonical. Comparison styles remain local to their selected view, and the
ordered comparison remains in the generated marker; view-specific change
metadata is not placed on shared model elements.

A project view entry may provide an adapter-owned LikeC4 view identifier while
retaining the native projection identity in the generated ownership marker.
The repository assigns `index` to its landscape projection so LikeC4 opens a
bounded, intentional landing view instead of synthesizing an index over every
element in the union. This is presentation identity, not a second semantic
query or a mutation of the canonical projection.
