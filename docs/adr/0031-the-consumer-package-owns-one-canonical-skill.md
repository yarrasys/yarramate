# The consumer package owns one canonical skill

Status: accepted

The installable YarraMate package contains only its built runtime, normative
schemas, consumer guidance, and one canonical `yarramate-architecture` skill.
Repository-local Codex and Claude entrypoints link to that packaged skill
rather than copying it. This keeps harness discovery replaceable, prevents
methodology drift between agents, and avoids shipping the development
repository or treating local packaging as publication approval.
