# MCP affordance is an adapter over the stable CLI

Status: accepted

Agent harnesses discover typed tool schemas more reliably than `--help`
text, and several load MCP servers by default. YarraMate meets them with
`yarramate-mcp`: a dependency-free stdio server exposing read-only
architecture context — status, check, reconcile, and bounded context
(projection, ad-hoc subjects, token budget).

The server is an adapter in exactly the sense the product contract
requires: every tool call executes the same stable CLI surface, no
privileged API or second semantics exists, and nothing mutates native
documents. Like the LikeC4 and Graphify adapters it ships as a separate
binary outside the Core release contract, and Core does not depend on it.

Write operations (`add`, `connect`, `new`) stay CLI-only for now: a write
tool changes the server's safety class from "always safe to connect" to
"reviewed per deployment", and that step deserves its own decision once
read-only usage proves itself.
