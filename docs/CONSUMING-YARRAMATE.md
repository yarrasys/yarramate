# Consuming YarraMate

Native documents in the consuming repository remain canonical. Consumer
commands are documented as `yarramate ...` because the executable is the
stable product interface regardless of how it was installed.

## Published quick start

Once the package and public repository are published:

```sh
npm install --global yarramate
npx skills add yarrasys/yarramate --skill yarramate-architecture
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

Before the first npm release, validate consumption through a local package
artifact. From the YarraMate repository:

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

For Claude Code, the repository is its own plugin marketplace:

```sh
/plugin marketplace add yarrasys/yarramate
/plugin install yarramate-architecture@yarramate
```

The marketplace entry points at `skills/yarramate-architecture` in this
repository, so the installed plugin is the canonical skill rather than a
copy. It declares no version, taking its version from the commit it was
installed from.

For other harnesses, use the agent-skills installer:

```sh
npx skills add yarrasys/yarramate --skill yarramate-architecture
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
yarramate reconcile .yarramate/workspace.yaml
yarramate ask .yarramate/workspace.yaml \
  .yarramate/projections/<projection>.yaml
```

Evidence overlays declared in the manifest are evaluated by `reconcile`
(and gated by `check --strict`) rather than through a separate command.
Evidence remains distinct from declared intent. A generated proposal becomes
canonical only through the consuming repository's normal Git review.

## Architecture-first design

Ask the harness to use `$yarramate-architecture` to design the solution before
implementation. The skill records alternatives, target intent, and bounded
implementation context, then runs:

```sh
yarramate check .yarramate/workspace.yaml --json
yarramate ask .yarramate/workspace.yaml \
  .yarramate/projections/<alternatives>.yaml
yarramate ask .yarramate/workspace.yaml \
  .yarramate/projections/<target>.yaml
yarramate ask .yarramate/workspace.yaml \
  --compare <baseline-state> <target-state>
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

## Visual architecture conversations

Ask the harness to use `$yarramate-architecture` to visually explain the
architecture, show how a question relates to the model, or compare design
choices. There is no command to learn: the skill orchestrates the
`yarramate-visual` runtime that ships in this package, exactly as it
orchestrates `yarramate` and `yarramate-likec4`.

Installation and runtime stay separate here too. `npm install` provides the
`yarramate-visual` binary and the prebuilt browser application; the skill
provides the journey. Neither contains the other.

What the journey guarantees:

- **Authority is labelled.** Repository architecture is rendered only from a
  workspace that passes `yarramate check`, through
  `yarramate ask <workspace> "<topic>" --json`. Everything else — general
  questions, hypotheticals, comparisons of undecided options — is rendered as
  a temporary `ad-hoc` model the browser labels non-canonical. A choice
  confirmed in the browser is a recorded selection, not declared intent; it
  becomes canonical only through the normal design journey and Git review.
- **The server is local only.** It binds `127.0.0.1` on a random port, issues
  separate browser and agent credentials, ships no external assets, and stores
  no provider credentials. Session state lives under the ignored
  `.yarramate-out/visual/` directory and is never canonical.
- **The renderer is consented.** The skill prefers a repository-local
  `likec4` in `>=1.59.2 <1.60.0`. With none available it asks once before
  resolving the pinned `likec4@1.59.2` runner, which needs Node `>=22.22.3`
  and adds no dependency to your repository. The semantic binaries keep the
  package's existing Node contract.
- **Chat is capability-gated.** Where the harness can delegate a child agent,
  deliver its completion back, and stay interruptible, the browser carries a
  chat widget answered by a bounded visual agent. That agent may replace only
  the temporary session model; it cannot edit repository files, `.yarramate/`,
  credentials, or harness configuration.
- **Otherwise you get diagram-only mode.** The same custom renderer and view
  navigation, with the conversation continuing in the main harness.
- **Recovery is the main agent's.** On End, cancellation, or any failure the
  main agent recovers a structured handoff — confirmed decisions, requested
  changes, unresolved questions, final views, termination reason — before
  anything is torn down. The raw transcript is returned only on request.
- **Cleanup is automatic.** Stopping shuts the server process tree down and
  deletes the temporary session; a later start prunes any orphan older than
  24 hours.

Consumers validating the protocol can import the versioned documents directly,
for example `yarramate/schema/visual-handoff` or
`yarramate/schema/visual-session-request`.

## MCP server for agent harnesses

Harnesses that load MCP servers can connect the bundled read-only adapter:

```json
{
  "mcpServers": {
    "yarramate": {
      "command": "yarramate-mcp"
    }
  }
}
```

It exposes `yarramate_ask` (orientation, free text, subject ids, or a
projection path, with an optional token budget), `yarramate_design`,
`yarramate_check`, and `yarramate_reconcile`. Every tool call executes the
same stable CLI in the server's working directory; nothing mutates native
documents, and authoring stays with the CLI and Git review.

## Continuous drift signal in CI

The repository root ships a composite GitHub Action that checks the
workspace and reports intent-vs-evidence drift on every pull request:

```yaml
name: architecture
on: pull_request
jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - uses: yarrasys/yarramate@main
        with:
          workspace: .yarramate/workspace.yaml
```

The job fails on deterministic correctness errors and, by default, when
reconciliation reports contradicted claims; unknown and not-observed
findings are reported in the job summary without failing. Set
`fail-on-contradiction: 'false'` to make the whole signal advisory. The
action never mutates sources — it runs only the read-only `check` and
`reconcile` commands, so it is safe as a required check.
