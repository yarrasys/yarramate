# LikeC4 deployments instantiate projected concepts

Status: accepted

A LikeC4 project view may declare adapter-owned deployment nodes and named
instances of concepts selected by its semantic projection. Nodes use a small
presentation vocabulary—environment, zone, host, and runtime—and may form an
acyclic hierarchy. Every instance names an existing node and projected native
concept.

Deployment topology and instance placement are LikeC4 presentation hints in
the adapter project. They do not become graph-v2 claims or imply that Core has
a deployment model. Node and instance identities share one project-wide
deployment namespace because every project view is emitted into one LikeC4
model. Invalid references, duplicate identities, and parent cycles are
source-located adapter errors.
