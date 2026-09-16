/**
 * `yarramate/host`: the editor's local host without the editor (ADR 0156).
 *
 * `createLocalHost` runs the engine over a store the caller owns and speaks
 * the visual protocol (`VisualServerFrame` out, `VisualBrowserInput` in,
 * ADR 0081) with no React, cytoscape or stylesheet behind it, so a server
 * can run the same host the browser runs and fan its frames to sockets.
 * `yarramate/visual-app` exports the same names for a page that mounts the
 * editor; this entry is for the other side of the wire.
 */
export {
  createLocalHost,
  type LocalEditorHost,
  type LocalHostOptions,
  type RefreshOutcome,
} from './host/local-host.js'
export type { EditorHost, EditorHostEvents } from './host/editor-host.js'
export type {
  VisualBrowserInput,
  VisualDiagnostic,
  VisualViewSummary,
} from './adapters/visual/protocol-contract.js'
export type {
  VisualRenderedModel,
  VisualServerFrame,
  VisualSessionSnapshot,
} from './adapters/visual/wire.js'
export { VISUAL_PROTOCOL_VERSION } from './adapters/visual/protocol-contract.js'
