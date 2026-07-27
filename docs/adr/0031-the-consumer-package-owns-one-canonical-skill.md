# The consumer package owns one canonical skill

Status: accepted

The installable YarraMate package contains only its built runtime, normative
schemas, consumer guidance, and one canonical `yarramate-architecture` skill.
The public repository exposes that same canonical skill to generic agent-skill
installers. An installed skill directory or a pre-publication repository-local
link is a deployment, not a harness-specific methodology fork. This keeps
harness discovery replaceable, prevents drift between agents, and avoids
shipping the development repository or treating local packaging as publication
approval.
