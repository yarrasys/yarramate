# Backlog disposition

This document distinguishes executable repository work from decisions and
external contracts that must not be implemented speculatively.

## Locally complete

The current repository implements the agreed foundation for:

- native documents, profiles, globally qualified graph v2, and deterministic
  source-located correctness;
- narrative claims on concept and relationship subjects plus explicit,
  checkable subject citations;
- explicit workspaces, projections, starter views, architecture states, and
  state comparison;
- existing-project discovery and architecture-first design through one
  portable agent skill;
- evidence evaluation and provider-neutral reconciliation;
- packed consumer installation and the stable CLI;
- successful check-result scale counts without a Core completeness policy;
- projection-driven LikeC4 element, comparison, dynamic, and deployment
  views in one generated project, with relationship rationale retained in
  logical and dynamic output;
- non-destructive LikeC4 mapping synchronization, opt-in stale-entry pruning,
  and source-located project reference diagnostics;
- explicit Graphify node observation producing standard evidence overlays;
- native browser visualization and mechanical model editing through the
  `yarramate-visual` adapter, its published `yarramate/visual-protocol/v2`
  wire, and changeset commits that land through `yarramate apply`;
- ordered in-app undo and redo over the staged visual changeset.

Nothing locally actionable remains in the agreed scope. Undo and redo were the
last item, and they landed as an ordered history in the reviewer's own state,
not a new semantic, wire event, or write path: the history holds whole
snapshots of the staged operations, because staging replaces on a repeated
`(target, field)` and an inverse operation would have nothing left to restore
the replaced value from (ADR 0092). Its scope is deliberately the staged
operations alone: dragged positions and saved views persist as their own
documents with their own save and discard paths, so one shared stack would
make a single undo gesture ambiguous between un-staging an edit and moving a
node back. A landed batch is still reverted with `git revert`, never from the
browser, so both stacks are dropped once a commit lands. Everything else in
the agreed Core 0.1 and initial journey scope is implemented.

## Decision-gated

These items need a new authoritative semantic or product decision:

- **State-scoped claim values** require a graph-version decision because graph
  v2 currently expresses subject presence, not different names, kinds,
  ownership, or other values per state.
- **Additional contradiction rules** require original semantics and examples
  in a dedicated ADR; Core cannot infer architectural taste.
- **Automatic profile discovery or registries** require trust, resolution,
  version-conflict, offline, and supply-chain rules.
- **LikeC4 import or round-tripping** requires an explicit loss and conflict
  contract while native documents remain canonical.
- **General LikeC4 styling parity** has no bounded semantic acceptance
  criterion; styling is added only for a named presentation need.
- **Provider-driven architecture proposals** require a candidate-proposal
  contract distinct from evidence and declared intent.
- **CI policy for evidence findings** belongs to an opt-in consumer policy
  decision, not Core correctness.
- **Renaming a subject identity** requires an identity-succession decision.
  A globally qualified id is the identity: `yarramate/operations/v1` offers
  add, update, and delete for concepts and relationships but no rename, and
  `update-*` is enrich-only. A rename must therefore state what happens to
  relationship endpoints, claim subjects, projection membership, evidence
  observations, attestations, and `.yarramate/visual-layout` keys that name
  the old id, and whether `supersedes` expresses the succession.
- **Concurrent-edit conflict resolution across browsers** requires a
  staleness contract. `changeset.commit` re-reads the workspace from disk, so
  an operation naming a concurrently deleted subject already fails with Core
  diagnostics; but an enrich-only `update-concept` staged against a stale
  value overwrites a concurrent change undetected. Detection needs a base
  digest on the wire, and the reviewer-facing answer to a refused batch —
  rebase the staged operations, discard them, or review a three-way
  difference — is a product decision.

## Externally blocked

- Graphify relationship observation needs stable external edge identities and
  their documented semantics. The consumed Graphify graph currently provides
  stable node IDs but not an equivalent edge identity contract.
- ArchiMate or another external-language compatibility profile needs licensing
  confirmation and independently governed mappings.

Publication preparation is complete: the repository identity is
`yarrasys/yarramate`, all repository material uses the MIT licence, and normal
pull requests require no additional contributor agreement or sign-off.

## Demand-gated

Additional authoring, catalogue, source, runtime, visualization, or evidence
adapters need a named tool, consumer journey, input/output contract, and
acceptance fixture. “Additional adapters” alone is not an implementable
requirement.

This gate has been resolved once, for browser visualization and mechanical
editing: the named tool is cytoscape.js, the consumer journey is a reviewer
reading and correcting the model in a session, the contract is
`yarramate/visual-protocol/v2`, and the acceptance fixtures are the visual
session, protocol, and app suites. Further adapters in any of these
categories still need their own four answers.

When one of these gates is resolved, add a bounded roadmap item and ADR before
implementation. Until then the local backlog holds only the named actionable
item above, rather than being silently expanded.
