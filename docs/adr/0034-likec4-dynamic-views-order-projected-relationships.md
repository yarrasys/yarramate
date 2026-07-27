# LikeC4 dynamic views order projected relationships

Status: accepted

A LikeC4 project view may supply an adapter-owned ordered list of relationship
subject identities selected by its semantic projection. The projection bounds
the logical model; each dynamic step references an existing native
relationship and may override only its displayed title. The adapter derives
the step endpoints from compiled claims.

Step order is LikeC4 presentation, not a new graph-v2 claim or native workflow
semantics. Missing or non-relationship step subjects are source-located adapter
errors. Core remains unaware of dynamic views.
