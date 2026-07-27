# State-comparison visualization is adapter presentation

Core architecture-state comparison classifies globally qualified subjects as
added, removed, or retained. It does not prescribe colors, line styles,
diagram structure, or renderer vocabulary.

The optional LikeC4 adapter may consume that comparison alongside a projection
that selects both compared states. It preserves the classification as flat
`yarramateChange` metadata and emits local view styles using valid LikeC4
selectors. Added concepts are green, removed concepts are red with a dashed
border, and retained concepts are gray. These defaults are derived
presentation, not semantic claims.

Both compared states must be selected by the projection. The adapter rejects
an incomplete comparison view rather than silently omitting removed or added
subjects. Generated-project ownership records the ordered comparison identity,
so regenerating the same directory with a different comparison is refused.

Relationship classifications remain available as metadata. The first adapter
slice styles concepts only because element selectors are stable and
unambiguous; it does not invent relationship identities or encode adapter
styles in native documents.

## Status

Accepted.
