# Graphify evidence requires explicit subject mapping

Status: accepted

The optional Graphify adapter reads generated Graphify node identities only
through a versioned adapter mapping. It emits a standard YarraMate evidence
overlay: mapped nodes present in the graph are confirmed and absent nodes are
not observed. It does not infer native concepts, relationships, or intent from
paths, labels, communities, similarity, or topology.

The initial adapter evaluates concept subjects only because the consumed
Graphify graph does not supply a stable edge identity suitable for native
relationship subjects. Graphify extraction remains external, and Core has no
Graphify runtime dependency.
