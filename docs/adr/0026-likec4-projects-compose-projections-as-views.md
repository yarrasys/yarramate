# LikeC4 projects compose projections as views

A versioned adapter-owned project definition composes multiple semantic
projections into one derived LikeC4 logical model with one view per projection.
The adapter unions mapped subjects before rendering rather than merging
independently generated model files, which avoids duplicate declarations while
keeping projection queries independent and native YarraMate documents
canonical. Comparison styles remain local to their selected view, and the
ordered comparison remains in the generated marker; view-specific change
metadata is not placed on shared model elements.
