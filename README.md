# YarraMate

[![npm](https://img.shields.io/npm/v/yarramate)](https://www.npmjs.com/package/yarramate)
[![CI](https://github.com/yarrasys/yarramate/actions/workflows/ci.yml/badge.svg)](https://github.com/yarrasys/yarramate/actions/workflows/ci.yml)
[![CodeQL](https://github.com/yarrasys/yarramate/actions/workflows/codeql.yml/badge.svg)](https://github.com/yarrasys/yarramate/actions/workflows/codeql.yml)
[![license: MIT](https://img.shields.io/github/license/yarrasys/yarramate)](LICENSE)

**[yarramate.dev](https://yarramate.dev)** ·
[Case study](docs/CASE-STUDY-CROSS-HARNESS.md) ·
[Documentation](docs/README.md)

Your coding agents re-derive your system's design every session — and each
one derives it a little differently. The design document that could stop
them says whatever it said the day someone last edited it.

YarraMate keeps the design as a small, checked model in git instead. Agents
and people read prose rendered from it — bounded briefs and open design
questions — write decisions back through validated batches, and the CLI
mechanically proves the model still matches the code as changes land.

There is no LLM inside and no service behind it: the engine is a
deterministic CLI, nothing leaves your repository, and git remains the only
governance — a proposed change becomes architecture when a human merges it.

> YarraMate is pre-release software. Interfaces may evolve before the first
> stable release.

## Two minutes to a model

```sh
npm install -g yarramate

yarramate init .                                 # scaffold .yarramate/, write the agent pointer
yarramate design .yarramate/workspace.yaml       # the interview: the top open design question
yarramate apply answers.yaml .yarramate/workspace.yaml   # answers land as one atomic batch
yarramate check .yarramate/workspace.yaml        # names resolve and rules hold — or it says where not
```

The whole surface is seven verbs, one per lifecycle stage:

```text
init → design → apply → ask → check → reconcile → export
create  fill    write   read  gate    drift       derive
```

`design` recomputes the next open question from the model itself — there is
no session state anywhere. That is the design bet: the model, not the
session, is the state, so any agent in any harness resumes the interview
cold, and a crashed session or a vendor switch costs nothing.

## Every fact is a claim

What you author — plain YAML in git:

```yaml
concepts:
  - id: order-gateway
    kind: applicationComponent
    name: Order Gateway
    status: current
```

What the engine checks — a claim in the compiled graph, with provenance:

```json
{
  "subject": "orders#order-gateway",
  "predicate": "yarramate/concept/kind",
  "value": "yarramate/core@0.1#applicationComponent",
  "origin": "declared",
  "source": { "document": "orders", "line": 3, "column": 5 }
}
```

What an agent reads — deterministic prose rendered from the graph:

> "Order Gateway is an application component; it already exists in this
> system."

Every sentence stands on claims, and every claim cites the file and line it
came from. The same YAML compiles to a byte-identical graph and the same
sentence, every time. There is no other structure to learn: concepts,
relationships, statuses, owners, and evidence are all claims.

## What structure buys

Three things prose alone can't do — and deliberately the whole list:

- **Identity** — a stable name every agent agrees on. References resolve or
  the model doesn't compile; two sessions can't invent two names for the
  same component.
- **Verifiability** — internal consistency and drift against the code,
  checked mechanically. A claim of "current" without supporting evidence is
  flagged the moment it becomes checkable, and `reconcile` reports both
  sides of every disagreement without auto-fixing either.
- **Sliceability** — each implementer receives exactly its neighbourhood: a
  bounded, deterministic brief rendered from the model, so parallel agents
  share one map.

Anything a good document does as well, we leave to your documents. The model
holds only what nothing can derive from code: what's planned, what was
deliberately retired, who owns what, and why.

## Proven across harnesses

We tested the handover bet adversarially on a real product: a Claude Code
session worked the design interview all day, then an OpenAI Codex session —
no shared context, the tool never named in the prompt — resumed it from a
ten-line pointer file and the published CLI. It answered 63 open design
questions, filed two genuine defect reports, and in a later session reported
that the model "was not merely documentation" — it caught an approval-path
regression before the release shipped.

The full story, with every commit, PR, and release attached:
[The model is the handover](docs/CASE-STUDY-CROSS-HARNESS.md).

## Research, honestly

We benchmark our own claims and publish the misses alongside the wins:

- **Held** — cross-harness handover; elicitation (tool-equipped agents
  across three model tiers reached a green check first try, 5/5, and
  converged on a design question zero freehand frontier runs ever asked);
  lie resistance (five builds from deliberately corrupted models — zero
  lies reached code).
- **Not held** — under a strong external spec, a checked model did not
  measurably beat a good design document on build convergence. We ran that
  experiment and published it.

Results with full transcripts, diffs, and the adjudication trail:
[docs/research/context-benchmark](docs/research/context-benchmark) and
[yarramate-bench-results](https://github.com/yarrasys/yarramate-bench-results).

And honestly: maintaining a model is rent. Two things make it payable —
agents do most of the authoring through the interview loop, and the engine
tells you exactly what's missing instead of leaving completeness to
discipline. It pays when more than one agent, session, or human has to
share the same map.

## For AI agents

If you are an agent working in a repository with a `.yarramate/` workspace,
orientation is one call and the loop is three:

```sh
yarramate ask .yarramate/workspace.yaml      # verdict, drift summary, backlog — one round-trip
yarramate design .yarramate/workspace.yaml   # the top open design question + its model slice
# answer with an operations batch, then:
yarramate apply operations.yaml .yarramate/workspace.yaml
```

Re-run `design` for the next question. Stop with an uncommitted, reviewable
diff — merging is the human acceptance step, not yours.

- Every command takes `--json` and returns a versioned, schema-backed
  envelope; writes are atomic batches that compile as a whole workspace or
  are rejected outright, so you cannot half-corrupt a document.
- `ask` accepts free text (`yarramate ask <ws> "billing"`), `--subjects`
  for the full roster, `--where` for evidence-backed pointing, and
  `--changed <git-range>` for review slices.
- `export rtm <ws> --out <dir>` derives the requirements traceability
  matrix: every requirement traced to its motivation, realizers, evidence
  verdicts, and attestations, with a `path:line` citation per cell.
- `init` writes the discovery pointer into both `AGENTS.md` and
  `CLAUDE.md`, so this section finds you rather than the reverse.
- `yarramate-mcp` exposes four read-only tools (ask/design/check/reconcile)
  over MCP stdio.
- In Claude Code, this repository is its own plugin marketplace:

  ```sh
  /plugin marketplace add yarrasys/yarramate
  /plugin install yarramate-architecture@yarramate
  ```

The full agent contract is [docs/AGENT-INTERFACE.md](docs/AGENT-INTERFACE.md).

## Product boundaries

YarraMate Core owns native, versioned architecture documents; compiles a
claim-centred, tool-neutral semantic graph; checks deterministic correctness
rather than architectural taste; supports explicit workspaces, profiles,
projections, evidence, and architecture states; and exposes a stable CLI for
people, CI, skills, and agent harnesses.

Optional adapters provide LikeC4 visualization from semantic projections,
Graphify observations as evidence overlays, loopback-only visual
conversations that render the native model and land reviewer edits through
the same validated `apply` batch (beta), and separately governed
compatibility profiles for external languages. Core depends on none of them.

YarraMate is not affiliated with or certified by The Open Group. ArchiMate®
is a registered trademark of The Open Group. LikeC4 and Graphify are
independent projects; their mention does not imply affiliation or
endorsement.

## Development

Requirements: Node.js 22 or newer, Corepack.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run verify
```

The full CI command runs typechecking, tests, native self-validation, LikeC4
generation, and LikeC4 validation. Useful focused commands: `pnpm build`,
`pnpm test`, `pnpm typecheck`, `pnpm self:check`, `pnpm self:reconcile`,
`pnpm self:check:likec4`, `pnpm docs:dev`.

```text
src/                 compiler, CLI, graph, and adapter sources
schema/              normative JSON Schemas
test/                tests and acceptance fixtures
skills/              portable architecture workflow for agent harnesses
.claude-plugin/      plugin marketplace manifest offering that skill
docs/                contracts, guides, and decisions
.yarramate/          canonical dogfooded architecture
.yarramate-out/      reproducible generated output (ignored)
```

When developing the repository, build and invoke the same executable
surface: `pnpm build`, then `node dist/cli.js <verb> …` mirrors every
command above. For a local consumer test:

```sh
pnpm pack --pack-destination /tmp/yarramate-package
npm install --global /tmp/yarramate-package/yarramate-*.tgz
yarramate --help
```

The [documentation index](docs/README.md) links the public guides and
maintainer material. Start semantic work with the
[product contract](docs/PRODUCT-CONTRACT.md) and
[glossary](docs/GLOSSARY.md). See
[Consuming YarraMate](docs/CONSUMING-YARRAMATE.md) for the packaged CLI,
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
lineage for operations that explicitly require kind ancestry. Graph v2
remains the stable, graph-only interchange result.

Normative schemas are available through package exports such as
`yarramate/schema/document`, `yarramate/schema/workspace`,
`yarramate/schema/graph-v2`, `yarramate/schema/projection`,
`yarramate/schema/evidence`, and `yarramate/schema/core-contract`. Optional
adapter entry points are exported from `yarramate/adapter/likec4` and
`yarramate/adapter/graphify`.

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
