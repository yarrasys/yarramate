# The clean break to seven verbs

Status: accepted

The fourteen-command surface accreted bottom-up: every command was
individually justified and collectively incoherent, and pre-release
with near-zero adoption was the only cheap moment to fix it (decision
2026-07-31, docs/AGENT-INTERFACE.md). With `design`, `apply`, `ask`,
and `export` shipped (ADRs 0057–0060), 0.7.0 removes the old names
with no aliases and no deprecation period:

Removed: `add`, `connect`, `new`, `compile`, `view`, `context`,
`status`, `next`, `compare`, `evidence`, `interrogate`.
Remaining: `init → design → apply → ask → check → reconcile → export`.

Choices the removal forced:

- **`new projection` gets no `apply` operation.** The migration map
  had pencilled it into `apply`; at build time the honest call was
  simpler: a projection is a plain YAML file with a published schema,
  authored directly and validated by `check`. Scaffolding sugar for a
  five-line file did not justify a manifest-editing operation type.
- **`evidence` leaves the public surface.** Its machinery lives on —
  `reconcile` evaluates workspace evidence and `check --strict` gates
  on contradictions — but the single-file evaluation form had become a
  debugging convenience with no journey behind it. The
  `yarramate/evidence-report/v1` format remains a library-level
  contract.
- **Machinery outlives its command.** `next`'s ordering core and
  `interrogate`'s evaluation and rendering are shared modules behind
  `ask` and `design`; only their command entries died.
- **The contract shrinks truthfully.** The core contract now declares
  exactly seven commands; `status-result/v1` and `next-result/v1` are
  gone (their content lives inside `ask-result/v1`); the commands enum
  in the contract schema accepts only the seven verbs.
- **The MCP server re-exposes the verbs.** Four read-only tools —
  `ask`, `design`, `check`, `reconcile` — replace the old
  status/context pair. Writes stay in the repository, through `apply`
  and git review, never through a server.
- **The model records the break.** The retired command services and
  their edges carry `status: retired` rather than being deleted: the
  architecture history of the product is part of the product.

`ask --kinds` lands in the same release: the declarable vocabulary —
core concept kinds by layer, relationship policies with their
endpoint-aspect constraints, and workspace profile extensions — as a
read, closing the gap where agents learned kinds by reading
`src/profile.ts` (#89).
