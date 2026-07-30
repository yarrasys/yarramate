# YarraMate

[![npm](https://img.shields.io/npm/v/yarramate)](https://www.npmjs.com/package/yarramate)
[![CI](https://github.com/yarrasys/yarramate/actions/workflows/ci.yml/badge.svg)](https://github.com/yarrasys/yarramate/actions/workflows/ci.yml)
[![CodeQL](https://github.com/yarrasys/yarramate/actions/workflows/codeql.yml/badge.svg)](https://github.com/yarrasys/yarramate/actions/workflows/codeql.yml)
[![license: MIT](https://img.shields.io/github/license/yarrasys/yarramate)](LICENSE)

YarraMate is a tool-neutral semantic architecture engine and guided
methodology. It turns architectural intent into deterministic, testable
context shared by people and agents.

> YarraMate is pre-release software. Interfaces may evolve before the first
> stable release.

## Why YarraMate?

Architecture documents often drift away from implementation or become tied to
one notation and tool. YarraMate keeps concise, native YAML documents
canonical and compiles them into an explicit semantic graph.

The same model supports two workflows:

- discover an existing project's architecture from repository evidence;
- design a solution before implementation and later reconcile intent with
  evidence.

Git provides authorship, review, history, and acceptance. YarraMate does not
introduce a parallel governance workflow.

## Product boundaries

YarraMate Core:

- owns native, versioned architecture documents;
- compiles a claim-centred, tool-neutral semantic graph;
- checks deterministic correctness rather than architectural taste;
- supports explicit workspaces, profiles, projections, evidence, and
  architecture states;
- exposes a stable CLI for people, CI, skills, and agent harnesses.

Optional adapters provide:

- LikeC4 visualization from semantic projections;
- Graphify observations as evidence overlays;
- separately governed compatibility profiles for external languages.

Core does not depend on LikeC4, Graphify, or ArchiMate.

YarraMate is not affiliated with or certified by The Open Group. ArchiMate® is
a registered trademark of The Open Group. LikeC4 and Graphify are independent
projects; their mention does not imply affiliation or endorsement.

## Repository layout

```text
src/                 compiler, CLI, graph, and adapter sources
schema/              normative JSON Schemas
test/                tests and acceptance fixtures
skills/              portable architecture workflow for agent harnesses
docs/                contracts, guides, and decisions
.yarramate/          canonical dogfooded architecture
.yarramate-out/      reproducible generated output (ignored)
```

The [documentation index](docs/README.md) links the public guides and
maintainer material. Start semantic work with the
[product contract](docs/PRODUCT-CONTRACT.md) and
[glossary](docs/GLOSSARY.md).

## Development

Requirements:

- Node.js 22 or newer
- Corepack

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run verify
```

The full CI command runs typechecking, tests, native self-validation, LikeC4
generation, and LikeC4 validation.

Useful focused commands:

```sh
pnpm build
pnpm test
pnpm typecheck
pnpm self:check
pnpm self:evidence
pnpm self:reconcile
pnpm self:check:likec4
pnpm self:export:likec4
pnpm docs:dev
```

## CLI

Install the published executable or invoke it directly with `npx`:

```sh
npm install --global yarramate
yarramate --help

npx yarramate check .yarramate/workspace.yaml
npx yarramate status .yarramate/workspace.yaml --json
```

When developing the repository, build and invoke the same executable surface:

```sh
pnpm build

node dist/cli.js init .
node dist/cli.js check .yarramate/workspace.yaml --json
node dist/cli.js compile .yarramate/workspace.yaml
node dist/cli.js context .yarramate/projections/context.yaml .yarramate/workspace.yaml
node dist/cli.js view .yarramate/projections/context.yaml .yarramate/workspace.yaml
node dist/cli.js next .yarramate/projections/context.yaml .yarramate/workspace.yaml
node dist/cli.js evidence .yarramate/evidence/repository.yaml .yarramate/workspace.yaml
node dist/cli.js reconcile .yarramate/workspace.yaml
```

`init` creates `.yarramate/architecture/main.yaml` and
`.yarramate/workspace.yaml`. Commands accept explicit source documents or one
explicit workspace manifest.

For a local consumer test, create a package artifact:

```sh
pnpm pack --pack-destination /tmp/yarramate-package
npm install --global /tmp/yarramate-package/yarramate-*.tgz
yarramate --help
```

See [Consuming YarraMate](docs/CONSUMING-YARRAMATE.md) for the packaged CLI,
schemas, agent skill, and optional adapters.

## Library API

The typed library exposes the same deep compiler seam:

```ts
import { compileWorkspace } from 'yarramate'

const result = compileWorkspace([
  { path: 'architecture.yaml', source: yamlSource },
])
```

`compileWorkspaceWithProfileContext` additionally returns resolved profile
lineage for operations that explicitly require kind ancestry. Graph v2 remains
the stable, graph-only interchange result.

Normative schemas are available through package exports such as:

```text
yarramate/schema/document
yarramate/schema/profile
yarramate/schema/workspace
yarramate/schema/graph-v2
yarramate/schema/projection
yarramate/schema/evidence
yarramate/schema/core-contract
```

Optional adapter entry points are exported from:

```text
yarramate/adapter/likec4
yarramate/adapter/graphify
```

## Contributing and security

Found a bug, confusing behaviour, missing capability, documentation problem,
or possible improvement? Please
[open a GitHub Issue](https://github.com/yarrasys/yarramate/issues/new).
Issues are welcome from users, contributors, agents, and curious observers.
You do not need to provide a solution, formal proposal, or implementation.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes to native
semantics or stable interfaces. Report suspected vulnerabilities according to
[SECURITY.md](SECURITY.md). Participation is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md), and help channels are described in
[SUPPORT.md](SUPPORT.md).

YarraMate is available under the [MIT License](LICENSE).
