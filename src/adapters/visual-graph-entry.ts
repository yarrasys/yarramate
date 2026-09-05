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
