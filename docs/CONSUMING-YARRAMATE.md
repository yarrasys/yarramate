# Consuming YarraMate

YarraMate is currently validated as a local package artifact and is not
published. Native documents in the consuming repository remain canonical.

## Install a local artifact

From the YarraMate repository:

```sh
pnpm pack --pack-destination /tmp/yarramate-package
```

In a consuming project:

```sh
pnpm add --save-dev /tmp/yarramate-package/yarramate-0.1.0.tgz
pnpm exec yarramate init .
pnpm exec yarramate check .yarramate/workspace.yaml --json
```

The package contains the CLI runtime, normative schemas, and the canonical
`yarramate-architecture` skill. It excludes the YarraMate repository
self-model, source, tests, and fixtures.

## Make the skill visible to an agent harness

Keep the packaged skill as the single source. Thin repository-local links may
expose it using a harness convention:

```sh
mkdir -p .agents/skills .claude/skills
ln -s ../../node_modules/yarramate/skills/yarramate-architecture \
  .agents/skills/yarramate-architecture
ln -s ../../node_modules/yarramate/skills/yarramate-architecture \
  .claude/skills/yarramate-architecture
```

The `.agents` link is suitable for Codex installations that load repository
skills from that convention. The `.claude` link uses Claude Code's
repository-skill convention. Harnesses may also load the canonical
`SKILL.md` by its package path directly. Do not copy and independently edit
the skill for each harness.

## Existing-project discovery

Ask the harness to use `$yarramate-architecture` to discover the project.
The skill will inspect repository evidence, propose native documents, and run:

```sh
pnpm exec yarramate check .yarramate/workspace.yaml --json
pnpm exec yarramate evidence \
  .yarramate/evidence/<evidence>.yaml \
  .yarramate/workspace.yaml
pnpm exec yarramate context \
  .yarramate/projections/<projection>.yaml \
  .yarramate/workspace.yaml
```

Evidence remains distinct from declared intent. A generated proposal becomes
canonical only through the consuming repository's normal Git review.

## Architecture-first design

Ask the harness to use `$yarramate-architecture` to design the solution before
implementation. The skill records alternatives, target intent, and bounded
implementation context, then runs:

```sh
pnpm exec yarramate check .yarramate/workspace.yaml --json
pnpm exec yarramate context \
  .yarramate/projections/<alternatives>.yaml \
  .yarramate/workspace.yaml
pnpm exec yarramate context \
  .yarramate/projections/<target>.yaml \
  .yarramate/workspace.yaml
pnpm exec yarramate compare \
  <baseline-state> <target-state> \
  .yarramate/workspace.yaml
```

The CLI verifies deterministic correctness. It does not approve the design or
require a complete model.
