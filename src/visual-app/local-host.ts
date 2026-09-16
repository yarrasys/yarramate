// Moved to src/host/local-host.ts (ADR 0156); this path keeps every import
// inside the editor and every published type name where it was.
export {
  createLocalHost,
  type LocalEditorHost,
  type LocalHostOptions,
  type RefreshOutcome,
} from '../host/local-host.js'
