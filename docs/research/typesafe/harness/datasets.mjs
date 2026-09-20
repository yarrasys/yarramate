// Datasets for the judgment experiment: each is a yarramate workspace compiled
// with the engine build in ../../../../dist, frozen at the commit named in
// PROTOCOL.md. Nothing here calls a model.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dist = resolve(here, '../../../../dist')

const engine = await import(join(dist, 'index.js'))
const tools = await import(join(dist, 'tools-entry.js'))
const projection = await import(join(dist, 'graph-projection.js'))
const readings = await import(join(dist, 'relationship-reading.js'))
const identity = await import(join(dist, 'subject-identity.js'))

export const DATASETS = {
  // The engine's own model at the tag this branch was cut from.
  self: { manifest: resolve(here, '../../../../.yarramate/workspace.yaml'), public: true },
  // The site's showcase, copied read-only; see datasets/halcyon/SOURCE.md.
  halcyon: { manifest: resolve(here, '../datasets/halcyon/workspace.yaml'), public: true },
  // ApertureX's reference architecture, copied read-only on the maintainer's instruction;
  // see datasets/patron-greeting/SOURCE.md for provenance and why it carries no real data.
  'patron-greeting': { manifest: resolve(here, '../datasets/patron-greeting/workspace.yaml'), public: false },
}

/** Reads a workspace from disk into the shape compileWorkspaceWithProfileContext wants. */
export const loadWorkspace = (manifestPath) => {
  const root = dirname(manifestPath)
  const manifestSource = readFileSync(manifestPath, 'utf8')
  const resolved = tools.resolveWorkspaceFrom({ path: 'workspace.yaml', source: manifestSource }, listFiles(root))
  if (!resolved.ok) throw new Error(`workspace did not resolve: ${JSON.stringify(resolved.diagnostics)}`)
  const ws = resolved.workspace
  const paths = [...ws.profiles, ...ws.documents, ...(ws.patterns ?? [])]
  const sources = paths.map((path) => ({ path, source: readFileSync(join(root, path), 'utf8') }))
  const compiled = engine.compileWorkspaceWithProfileContext(sources)
  if (!compiled.ok) throw new Error(`workspace did not compile: ${JSON.stringify(compiled.diagnostics.slice(0, 3))}`)
  const canvas = projection.projectGraphForCanvas(compiled.graph, compiled.profileContext)
  return { root, workspace: ws, graph: compiled.graph, profileContext: compiled.profileContext, canvas }
}

import { readdirSync, statSync } from 'node:fs'
const listFiles = (root, prefix = '') => {
  const out = []
  for (const entry of readdirSync(join(root, prefix))) {
    const rel = prefix === '' ? entry : `${prefix}/${entry}`
    if (statSync(join(root, rel)).isDirectory()) out.push(...listFiles(root, rel))
    else out.push(rel)
  }
  return out
}

/** Text of a node the way a question should see it: name, kind label, description. */
export const describe = (node) => ({
  name: node.name,
  kind: node.coreKindLabel,
  ...(node.description === null ? {} : { description: node.description }),
})

export const nodeById = (canvas) => new Map(canvas.nodes.map((node) => [node.id, node]))

/** The legal core relationship kinds between two nodes, from the ArchiMate table. */
export const legalKinds = (canvas, fromId, toId) => engine.connectableKinds(canvas, fromId, toId)

/** "Portal serves Patron" for a core kind, the engine's own phrase. */
export const readingOf = (kind) => readings.relationshipReading(kind, false)

/** Identity subjects for the near-duplicate arm, built the way the interrogation builds them. */
export const identitySubjects = (canvas) => {
  const neighbours = new Map()
  const link = (a, b) => {
    if (!neighbours.has(a)) neighbours.set(a, new Set())
    neighbours.get(a).add(b)
  }
  for (const edge of canvas.edges) {
    link(edge.from, edge.to)
    link(edge.to, edge.from)
  }
  return canvas.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    labels: [node.localId, node.name, ...node.aka],
    ...(node.owner === null ? {} : { owner: node.owner }),
    neighbours: neighbours.get(node.id) ?? new Set(),
    distinctFrom: new Set(node.distinctFrom),
  }))
}

export const lexical = identity
export const engineExports = engine
