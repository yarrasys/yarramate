# Consuming YarraMate

Native documents in the consuming repository remain canonical. Consumer
commands are documented as `yarramate ...` because the executable is the
stable product interface regardless of how it was installed.

## Published quick start

Once the package and public repository are published:

```sh
npm install --global yarramate
npx skills add yarradev/yarramate --skill yarramate-architecture
yarramate init .
yarramate check .yarramate/workspace.yaml --json
```

The first command installs the engine executable. The second installs the
canonical guided methodology for supported agent harnesses. They are separate:
the skill orchestrates the CLI and does not contain its runtime.

Projects that prefer a version-pinned development dependency may instead use:

```sh
npm install --save-dev yarramate
npx yarramate init .
```

Inside package scripts and agent harness commands, the project-local
executable is resolved as `yarramate`:

```json
{
  "scripts": {
    "architecture:check": "yarramate check .yarramate/workspace.yaml --json",
    "architecture:reconcile": "yarramate reconcile .yarramate/workspace.yaml"
  }
}
```

The remainder of this guide uses the direct executable form.

## Install a local artifact

YarraMate is currently private and validated through this pre-publication
path. From the YarraMate repository:

```sh
pnpm pack --pack-destination /tmp/yarramate-package
```

In a consuming project:

```sh
npm install --save-dev /tmp/yarramate-package/yarramate-0.1.0.tgz
npx yarramate init .
npx yarramate check .yarramate/workspace.yaml --json
```

The package contains the CLI runtime, normative schemas, and the canonical
`yarramate-architecture` skill. It excludes the YarraMate repository
self-model, source, tests, and fixtures.

## Install the agent skill

After the repository is public, use the agent-skills installer:

```sh
npx skills add yarradev/yarramate --skill yarramate-architecture
```

The installed directory is a deployment of the canonical repository skill,
not a harness-specific fork. Before publication, packed-artifact testing may
instead expose the packaged copy through thin local links:

```sh
mkdir -p .agents/skills .claude/skills
ln -s ../../node_modules/yarramate/skills/yarramate-architecture \
  .agents/skills/yarramate-architecture
ln -s ../../node_modules/yarramate/skills/yarramate-architecture \
  .claude/skills/yarramate-architecture
```

Do not independently edit installed or linked copies. Changes to the
methodology belong in the canonical repository skill.

## Existing-project discovery

Ask the harness to use `$yarramate-architecture` to discover the project.
The skill will inspect repository evidence, propose native documents, and run:

```sh
yarramate check .yarramate/workspace.yaml --json
yarramate evidence \
  .yarramate/evidence/<evidence>.yaml \
  .yarramate/workspace.yaml
yarramate reconcile .yarramate/workspace.yaml
yarramate context \
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
yarramate check .yarramate/workspace.yaml --json
yarramate context \
  .yarramate/projections/<alternatives>.yaml \
  .yarramate/workspace.yaml
yarramate context \
  .yarramate/projections/<target>.yaml \
  .yarramate/workspace.yaml
yarramate compare \
  <baseline-state> <target-state> \
  .yarramate/workspace.yaml
```

The CLI verifies deterministic correctness. It does not approve the design or
require a complete model.

## Optional Graphify evidence

When Graphify has generated `graphify-out/graph.json`, an explicit subject
mapping can produce a standard evidence overlay:

```sh
yarramate-graphify observe \
  graphify-out/graph.json \
  .yarramate/integrations/graphify/subject-mapping.yaml \
  .yarramate/workspace.yaml \
  --id repository-graphify \
  --version 1.0 \
  > .yarramate/evidence/graphify.yaml
```

Graphify extraction remains a separate installation and operation. The
adapter observes only explicitly mapped nodes and never promotes them into
canonical architecture.
