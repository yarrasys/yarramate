export {
  projectGraphForCanvas,
  type CanvasGraph,
  type CanvasNode,
  type CanvasEdge,
} from '../graph-projection.js'
// What contains what, and what a fold draws instead (#473). Published here
// rather than only on the canvas because a host that never renders still has to
// answer both: an interview counts open questions per box, a report says what
// an application is made of. `fold-tree.ts` imports nothing, so this subpath
// stays runtime-neutral.
export {
  foldTree,
  foldGraph,
  nestingTree,
  liftedEdgeId,
  NESTING_KIND_IDS,
  type FoldInput,
  type FoldNode,
  type FoldEdge,
  type FoldMembership,
  type FoldTree,
  type LiftedEdge,
  type NestingConflict,
  type SlotWiring,
} from '../fold-tree.js'
// What an edge says (ADR 0147) and the mode list it depends on (#587). The
// editor entry has exported these since #576, but that entry is the mounted
// editor, so a Worker importing one pure function from it took React and
// cytoscape too. `edge-label.ts` and `layout-mode.ts` reach no package.
export { edgeLabelText, type EdgeLabelData } from '../edge-label.js'
export { DEFAULT_LAYOUT, LAYOUT_MODES, type LayoutMode } from '../layout-mode.js'
// What the canvas puts on screen for a view, as plain data (#577): visibility,
// containment as drawn, fold chips, which edges draw and what a lifted edge
// counts. The canvas runs these two functions itself, so a host drawing the
// same picture elsewhere reads the same decisions. No positions: those are
// ELK's and the saved layout's. `canvas-scene.ts` reaches no package.
export {
  canvasSceneInput,
  drawnCanvasEdges,
  resolveCanvasScene,
  type CanvasScene,
  type CanvasSceneEdge,
  type CanvasSceneFold,
  type CanvasSceneInput,
  type CanvasSceneNode,
} from '../canvas-scene.js'
