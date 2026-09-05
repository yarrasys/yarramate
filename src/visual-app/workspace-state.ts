import type {
  CanvasEdge,
  CanvasGraph,
  CanvasNode,
} from "../graph-projection.js";
import { DEFAULT_NESTING, type NestingKind } from "../nesting.js";
import { DEFAULT_FOLD, type FoldMode } from "../fold-tree.js";
import {
  DEFAULT_DIRECTION,
  type LayoutDirection,
} from "../layout-direction.js";
import type { DecorationMap } from "./graph-canvas.js";
import type { ContextMenuTarget } from "./context-menu-model.js";
import type { BottomPanelTabId } from "./query-panel.js";

export interface SelectedElement {
  readonly type: "element";
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly description: string | null;
}

export interface SelectedRelationship {
  readonly type: "relationship";
  readonly id: string;
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly targetId: string;
  readonly targetTitle: string;
  readonly label: string | null;
  readonly description: string | null;
  readonly kind: string;
}

export type SelectedDiagramSubject = SelectedElement | SelectedRelationship;

/**
 * A relationship being drawn. The source is chosen first and the target
 * second, rather than dragged, so every step is a state transition a test can
 * make and a keyboard can reach.
 *
 * The kinds on offer are NOT held here: they are a function of the two
 * endpoints and the ArchiMate table, so they are derived on render by
 * `connectableKinds`. Storing them would let a stale palette outlive the model
 * frame it was computed from.
 */
export interface ConnectionDraft {
  readonly from: string;
  readonly to: string | null;
}

const optionalText = (value: string | null | undefined): string | null => {
  const text = value?.trim() ?? "";
  return text === "" ? null : text;
};

export const normalizeSelectedElement = (
  node: CanvasNode,
): SelectedElement => ({
  type: "element",
  id: node.id,
  title: node.name,
  kind: node.kindLabel,
  description: optionalText(node.description),
});

export const normalizeSelectedRelationship = (
  edge: CanvasEdge,
  nodeTitles: ReadonlyMap<string, string>,
): SelectedRelationship => {
  const sourceId = edge.from;
  const targetId = edge.to;
  return {
    type: "relationship",
    id: edge.id,
    sourceId,
    sourceTitle: nodeTitles.get(sourceId) ?? sourceId,
    targetId,
    targetTitle: nodeTitles.get(targetId) ?? targetId,
    label: optionalText(edge.name),
    description: optionalText(edge.description),
    kind: edge.kindLabel,
  };
};

const nodeTitlesOf = (graph: CanvasGraph): ReadonlyMap<string, string> =>
  new Map(graph.nodes.map((node) => [node.id, node.name] as const));

const nextElement = (
  graph: CanvasGraph,
  id: string,
): SelectedElement | null => {
  const node = graph.nodes.find((candidate) => candidate.id === id);
  return node === undefined ? null : normalizeSelectedElement(node);
};

const nextRelationship = (
  graph: CanvasGraph,
  id: string,
): SelectedRelationship | null => {
  const edge = graph.edges.find((candidate) => candidate.id === id);
  return edge === undefined
    ? null
    : normalizeSelectedRelationship(edge, nodeTitlesOf(graph));
};

/**
 * What the imperative methods read at the moment they are called (#297,
 * ADR 0118). A getter rather than a captured value, because the pointer is
 * handed up once and the graph changes under it with every commit - a method
 * bound to the model that existed at mount time would answer for a model
 * that is gone.
 */
export interface EditorPointerContext {
  readonly graph: CanvasGraph | null;
  readonly readOnly: boolean;
  /**
   * What the staged changeset pinned: path -> the revision that path held when
   * the first edit against it was staged (#444). Empty when nothing is staged.
   *
   * The pointer only reports these; it never compares them. A revision is
   * opaque and only the store that minted it may compare two (ADR 0100), so
   * the staleness question is answered host-side.
   */
  readonly stagedPins: Readonly<Record<string, string>>;
}

/**
 * The host's way of pointing at the canvas (#297, ADR 0118): three methods,
 * each the programmatic twin of a gesture the surface already has - a canvas
 * tap, a palette pick, the inspector's Connect. Every method answers with
 * whether it acted; false means nothing moved - the id named nothing, the
 * model has not arrived, or the mount is a viewer (#298) and the gesture
 * would have reached for the pen.
 */
export interface EditorPointer {
  readonly select: (subjectId: string) => boolean;
  readonly openDraft: (options?: { readonly kind?: string }) => boolean;
  readonly startConnection: (fromSubjectId: string) => boolean;
  /**
   * Replaces the host's per-subject marks wholesale (#314, ADR 0119) - the
   * map is the unit of exchange, never merged into what stood. Unlike its
   * siblings this one needs no model and no pen: the marks are client state
   * drawn when the graph (or its successor) is on screen, and decorating is
   * reading, so a viewer accepts them too. It answers false only where every
   * method does - a handle before the shell's first render or after disposal.
   */
  readonly setDecorations: (decorations: DecorationMap) => boolean;
  /**
   * The staged changeset's pins, for a host about to refresh the canvas
   * (#444). Reported, never interpreted: the host owns the store that minted
   * these revisions and is the only party that may compare them (ADR 0100).
   */
  readonly stagedPins: () => Readonly<Record<string, string>>;
}

/**
 * Builds the pointer over the shell's own dispatchers. Nothing here is a
 * second write path: every method dispatches the same workspace action its
 * on-screen twin dispatches, so what a host can reach is exactly what a
 * reviewer can reach, and anything staged still lands through the changeset.
 */
export const editorPointerFor = (
  context: () => EditorPointerContext,
  dispatch: (action: VisualWorkspaceAction) => void,
  seedDraftKind: (kind: string | undefined) => void,
  replaceDecorations: (decorations: DecorationMap) => void,
): EditorPointer => ({
  select: (subjectId) => {
    const { graph } = context();
    if (graph === null) return false;
    // The same lookup and normalization a canvas tap runs: a node becomes a
    // selected element, an edge a selected relationship with its endpoint
    // titles resolved, and an id that names neither moves nothing.
    const subject =
      nextElement(graph, subjectId) ?? nextRelationship(graph, subjectId);
    if (subject === null) return false;
    dispatch({ type: "subject.selected", subject });
    return true;
  },
  openDraft: (options) => {
    const { graph, readOnly } = context();
    // A viewer has no pen (#298, ADR 0117), and before the model arrives
    // there is no vocabulary to compile the Kind select from.
    if (readOnly || graph === null) return false;
    // The kind rides the same seed a palette pick rides (#295, ADR 0116):
    // into the form's own state, cleared by a plain call, so a host opening
    // the draft with no kind gets the no-default form every plain opener gets.
    seedDraftKind(options?.kind);
    dispatch({ type: "subject.draft.opened" });
    return true;
  },
  startConnection: (fromSubjectId) => {
    const { graph, readOnly } = context();
    if (readOnly || graph === null) return false;
    // Only a node can be a source: the connection tool draws from a subject,
    // and an edge or an unknown id has no endpoint to draw from.
    if (!graph.nodes.some((node) => node.id === fromSubjectId)) return false;
    dispatch({ type: "connection.started", from: fromSubjectId });
    return true;
  },
  stagedPins: () => context().stagedPins,
  setDecorations: (decorations) => {
    // No graph gate and no read-only gate, deliberately (#314, ADR 0119):
    // the marks are held client-side and rendered when a model is on screen,
    // so handing them before the host's first frame is not "nothing moved" -
    // the map landed, and the canvas draws it the moment there is one. And
    // decorating is reading: the primary consumer decorates frozen snapshots
    // under a read-only mount (#298).
    replaceDecorations(decorations);
    return true;
  },
});

/**
 * The right column's sections, in the order they stack (#249, ADR-free: the
 * design settles the order and nothing derives it).
 *
 * The palette leads (#295): it is the tool that makes subjects, and tools
 * read above inspection - a reviewer reaches for what to add before what is
 * selected. Chat is last because it is pinned at the foot and owns the
 * session's own control - the reviewer ends the conversation beside the
 * conversation, not from a strip that carries identity and nothing else.
 */
export const RIGHT_SECTIONS = [
  "palette",
  "properties",
  "questions",
  "changes",
  "chat",
] as const;

export type RightSectionId = (typeof RIGHT_SECTIONS)[number];

/** How short a section may be dragged before it is just a header. */
export const SECTION_MIN_HEIGHT = 96;
/** Room the sections above one must keep, however far it is dragged. */
export const SECTION_HEADROOM = 160;

export const sectionHeightBounds = (viewportHeight: number) => ({
  min: SECTION_MIN_HEIGHT,
  max: Math.max(SECTION_MIN_HEIGHT, viewportHeight - SECTION_HEADROOM),
});

export const clampSectionHeight = (
  height: number,
  viewportHeight: number,
): number => {
  const { min, max } = sectionHeightBounds(viewportHeight);
  return Math.min(max, Math.max(min, height));
};

export const CONVERSATION_MIN_WIDTH = 320;
export const CONVERSATION_MAX_WIDTH = 640;
/** The share of the viewport the approved design lets the conversation take. */
const CONVERSATION_MAX_VIEWPORT_SHARE = 0.45;

export interface VisualWorkspaceState {
  /**
   * The right column: one width, whether the reviewer has put the whole
   * column away, and the sections stacked inside it.
   *
   * The sections are collapsible one by one, and a reviewer who wants room
   * shuts sections rather than the column - shut headers say what is behind
   * them (#249). `hidden` is the further step for the moments that want the
   * whole canvas - presenting, a projector, a laptop - and the reopen strip
   * that stands in for the column carries what a shut header would have
   * said: the unread count and a waiting choice (#294).
   */
  /**
   * Whether the reviewer has put the left rail away (#294's shape, applied to
   * the other side of the workspace).
   *
   * A boolean and not a width, because the rail is a FIXED column rather than
   * a dragged one: it holds names at one size, so there is no dragged width to
   * restore and nothing for a mode-beside-width to protect. The branches
   * inside it already collapse one by one; this is the further step for the
   * moments that want the whole canvas.
   */
  readonly railHidden: boolean;
  readonly conversation: {
    readonly width: number;
    /**
     * Whether the reviewer has put the whole column away (#294). A mode
     * beside the width rather than a zero width, so the width stays what it
     * was and reopening restores it - sections and splitters intact. The
     * presenting moments are exactly when this is used, and presentation
     * must not cost the reviewer their layout.
     */
    readonly hidden: boolean;
    readonly unread: number;
    /** The sections the reviewer has shut. Held as what is CLOSED so a
     * section added later arrives open rather than hidden behind a default
     * nobody chose - the same rule the rail's branches follow. */
    readonly collapsed: readonly RightSectionId[];
    /** Heights for the two sections that have one; properties takes the rest. */
    readonly changesHeight: number;
    readonly chatHeight: number;
  };
  /**
   * The viewport this state was last clamped against. Presentation reads its
   * resize bounds from here rather than from `window`, so every viewport change
   * reaches the separator's reported minimum and maximum.
   */
  readonly viewportWidth: number;
  /** The viewport the SECTION heights are clamped against, held for the same
   * reason the width is: a shorter window changes what a splitter may be
   * dragged to, and a render that read the live global would only say so by
   * accident. */
  readonly viewportHeight: number;
  readonly selectedSubject: SelectedDiagramSubject | null;
  /** The relationship being drawn, or null when the tool is not in use. */
  readonly connection: ConnectionDraft | null;
  /**
   * Whether the add-a-subject form is open. Only the openness lives here: the
   * fields belong to the form while it is on screen, and a half-typed name is
   * not workspace state anyone else needs.
   */
  readonly draftingSubject: boolean;
  /**
   * The subject or relationship a deletion has been asked for, held until the
   * reviewer confirms. Deleting is the one motion that removes authored text,
   * so it is the one that asks first.
   */
  readonly pendingDeletion: string | null;
  /**
   * The view a deletion has been asked for, held until the reviewer confirms.
   * Separate from `pendingDeletion` because the two ask different questions: a
   * subject's deletion is described against the graph and takes relationships
   * with it, a view's removes one projection document and touches no subject.
   */
  readonly pendingViewDeletion: string | null;
  /**
   * The view being retitled, held while the reviewer types. Only the id: the
   * half-typed name belongs to the dialog while it is on screen.
   */
  readonly pendingViewRename: string | null;
  readonly descriptionExpanded: boolean;
  readonly detailsOpen: boolean;
  /**
   * The canvas column's foot panel: whether it is open, and which tab it shows.
   *
   * Collapsed at rest, because the canvas keeps the room until the reviewer
   * asks for it. The tab is remembered while it is shut, so re-opening returns
   * to the tab that was last read rather than to the first one.
   */
  readonly bottomPanel: {
    readonly open: boolean;
    readonly tab: BottomPanelTabId;
  };
  /**
   * The left rail's own state. The text narrows the rail and nothing else —
   * `quickFilterText` still narrows the canvas — and `collapsed` holds only
   * the branches the reviewer shut, so a folder or layer that appears later
   * arrives open rather than hidden behind a default nobody chose.
   */
  readonly tree: {
    readonly filterText: string;
    readonly collapsed: readonly string[];
  };
  /**
   * The open context menu: what was right-clicked and where the pointer was,
   * or null. The menu's CONTENTS are not held here — `contextMenuFor` derives
   * them from the model on every render, so a commit that lands while a menu
   * is open redraws it instead of leaving stale items over a subject that is
   * no longer there.
   */
  readonly contextMenu: {
    readonly target: ContextMenuTarget;
    readonly x: number;
    readonly y: number;
  } | null;
  /**
   * What draws as nesting in the active view, in precedence order (ADR 0101).
   * A view that says nothing keeps `DEFAULT_NESTING`, which is composition
   * alone - the behaviour that shipped before a view could say.
   */
  readonly nesting: readonly NestingKind[];
  /**
   * Whether the active view folds pattern instances by default (#473), and the
   * two sets that override it: boxes the reader shut beyond the default, and
   * boxes the reader OPENED against it.
   *
   * Two sets rather than one flag, because `fold.set` restates the view's
   * default on every view switch and a reader who opened a box must not have it
   * shut again the moment that default is read back. An instance draws folded
   * when the mode says so and it is not in `unfolded`, or when it is in
   * `folded` outright.
   */
  readonly foldMode: FoldMode;
  readonly folded: readonly string[];
  readonly unfolded: readonly string[];
  /**
   * Which way the active view runs its layers (#274, ADR 0121). A view that
   * says nothing runs `DEFAULT_DIRECTION`, the same rule `nesting` follows:
   * silence restores the default rather than carrying the previous view's
   * answer across.
   */
  readonly direction: LayoutDirection;
  readonly layout: "layered";
  readonly showLifecycle: boolean;
  readonly showEvidence: boolean;
  readonly showOwnership: boolean;
  readonly showNudges: boolean;
}

export type VisualWorkspaceAction =
  | {
      readonly type: "section.toggled";
      readonly section: RightSectionId;
    }
  | {
      readonly type: "section.resized";
      readonly section: "changes" | "chat";
      readonly height: number;
    }
  | { readonly type: "conversation.resized"; readonly width: number }
  | { readonly type: "conversation.toggled" }
  | { readonly type: "rail.toggled" }
  | {
      readonly type: "viewport.resized";
      readonly viewportWidth: number;
      readonly viewportHeight?: number;
    }
  | { readonly type: "attention.received" }
  | {
      readonly type: "connection.started";
      readonly from: string;
    }
  | {
      readonly type: "connection.targeted";
      readonly to: string;
    }
  | { readonly type: "connection.cancelled" }
  | { readonly type: "subject.draft.opened" }
  | { readonly type: "subject.draft.closed" }
  | { readonly type: "deletion.asked"; readonly id: string }
  | { readonly type: "deletion.dismissed" }
  | { readonly type: "viewDeletion.asked"; readonly id: string }
  | { readonly type: "viewDeletion.dismissed" }
  | { readonly type: "viewRename.asked"; readonly id: string }
  | { readonly type: "viewRename.dismissed" }
  | {
      readonly type: "subject.selected";
      readonly subject: SelectedDiagramSubject;
    }
  | { readonly type: "subject.cleared" }
  | { readonly type: "description.toggled" }
  | { readonly type: "details.toggled" }
  | { readonly type: "bottomPanel.toggled" }
  | {
      readonly type: "bottomPanel.tabSelected";
      readonly tab: BottomPanelTabId;
    }
  | {
      readonly type: "menu.opened";
      readonly target: ContextMenuTarget;
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: "menu.dismissed" }
  | { readonly type: "tree.filtered"; readonly filterText: string }
  | { readonly type: "tree.toggled"; readonly key: string }
  | {
      readonly type: "nesting.set";
      readonly nesting: readonly NestingKind[];
    }
  | {
      /**
       * The view's fold default plus whatever the sidecar saved, restated on
       * every view switch (#473) — the rule `nesting.set` follows.
       */
      readonly type: "fold.set";
      readonly mode: FoldMode;
      readonly folded: readonly string[];
      readonly unfolded: readonly string[];
    }
  | {
      /** One box opened or shut by a reader. */
      readonly type: "fold.toggled";
      readonly id: string;
    }
  | {
      /** Every instance at once, from the canvas menu. */
      readonly type: "fold.all";
      readonly folded: boolean;
      readonly ids: readonly string[];
    }
  | {
      readonly type: "direction.set";
      readonly direction: LayoutDirection;
    }
  | {
      readonly type: "layout.set";
      readonly layout: "layered";
    }
  | {
      readonly type: "presentation.toggled";
      readonly flag:
        | "showLifecycle"
        | "showEvidence"
        | "showOwnership"
        | "showNudges";
      readonly value: boolean;
    }
  | {
      readonly type: "model.replaced";
      /** The graph that replaced it, so a subject that survived the commit can
       * be re-read from it instead of being dropped along with the old model. */
      readonly graph: CanvasGraph | null;
    };

// A view switch adopts the view's own presentation: a field the view
// declares replaces whatever the workspace currently shows; a field it
// leaves unset keeps the workspace's current value untouched. Returns the
// actions to dispatch, in declaration order, so App.tsx has nothing left to
// decide - it only has to dispatch what comes back.
/** Order-insensitive set equality over subject ids (#473). */
const sameIds = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length &&
  new Set([...left, ...right]).size === new Set(left).size

const sameNesting = (
  left: readonly NestingKind[],
  right: readonly NestingKind[],
): boolean =>
  left.length === right.length &&
  left.every((kind, index) => kind === right[index]);

export const presentationActionsFor = (
  presentation:
    | {
        readonly layout?: "layered";
        readonly nesting?: readonly NestingKind[];
        readonly fold?: FoldMode;
        readonly direction?: LayoutDirection;
        readonly showLifecycle?: boolean;
        readonly showEvidence?: boolean;
        readonly showOwnership?: boolean;
      }
    | undefined,
): readonly VisualWorkspaceAction[] => {
  const actions: VisualWorkspaceAction[] = [];
  if (presentation?.layout !== undefined) {
    actions.push({ type: "layout.set", layout: presentation.layout });
  }
  // A view that omits `nesting` is restored to the default rather than left
  // holding the previous view's vocabulary: switching views must not carry a
  // containment meaning across into one that never asked for it.
  actions.push({
    type: "nesting.set",
    nesting: presentation?.nesting ?? DEFAULT_NESTING,
  });
  // Unconditional for the same reason as nesting: a view that omits `fold`
  // folds NOTHING, and must not inherit the folded state of the view the
  // reviewer came from. The saved sidecar, if there is one, is applied over
  // this by the caller — which is why both override sets start empty here.
  actions.push({
    type: "fold.set",
    mode: presentation?.fold ?? DEFAULT_FOLD,
    folded: [],
    unfolded: [],
  });
  // Unconditional for the same reason as nesting above: a view that omits
  // `direction` runs top-down, and must not inherit the left-right run of the
  // view the reviewer came from.
  actions.push({
    type: "direction.set",
    direction: presentation?.direction ?? DEFAULT_DIRECTION,
  });
  if (presentation?.showLifecycle !== undefined) {
    actions.push({
      type: "presentation.toggled",
      flag: "showLifecycle",
      value: presentation.showLifecycle,
    });
  }
  if (presentation?.showEvidence !== undefined) {
    actions.push({
      type: "presentation.toggled",
      flag: "showEvidence",
      value: presentation.showEvidence,
    });
  }
  if (presentation?.showOwnership !== undefined) {
    actions.push({
      type: "presentation.toggled",
      flag: "showOwnership",
      value: presentation.showOwnership,
    });
  }
  return actions;
};

// Which view still needs its query and presentation applied. A view reaches
// the canvas two ways - the reviewer picks one, or the session opens on the
// one the server named (`initialView`, also what a reload restores) - and
// only the first ever ran through the tree's handler, so a session opened
// on a view rendered the whole graph under workspace defaults and ignored
// the presentation that view declares. Both routes move the
// same `activeView` field, so the decision belongs here, keyed on what has
// actually been applied rather than on where the id came from. A view's query
// travels over the socket, but the opening snapshot arrives over HTTP before
// that socket is open, and a send on a closed socket is dropped - so an
// unconnected wire is "nothing to do yet" rather than "applied". Returns
// `null` when there is nothing to do: no wire, no active view (the reviewer
// cleared back to "All"), the active view is already applied, or its summary
// has not arrived with the model yet.
export const viewNeedingApplication = <View extends { readonly id: string }>(
  activeView: string,
  views: readonly View[],
  applied: string | null,
  connected: boolean,
): View | null => {
  if (!connected || activeView === "" || activeView === applied) return null;
  return views.find((view) => view.id === activeView) ?? null;
};

// `min(45vw, 640px)`, never below the 320px floor the panel is usable at.
export const conversationWidthBounds = (viewportWidth: number) => ({
  min: CONVERSATION_MIN_WIDTH,
  max: Math.max(
    CONVERSATION_MIN_WIDTH,
    Math.min(
      CONVERSATION_MAX_WIDTH,
      viewportWidth * CONVERSATION_MAX_VIEWPORT_SHARE,
    ),
  ),
});

const clampConversationWidth = (width: number, viewportWidth: number) => {
  const { min, max } = conversationWidthBounds(viewportWidth);
  return Math.min(max, Math.max(min, width));
};

// Initial width follows `clamp(320px, 28vw, 480px)` per the approved design;
// only a manual drag may widen the panel up to CONVERSATION_MAX_WIDTH (640).
const CONVERSATION_DEFAULT_MAX_WIDTH = 480;

const clampInitialConversationWidth = (
  width: number,
  viewportWidth: number,
) => {
  const { min, max } = conversationWidthBounds(viewportWidth);
  return Math.min(
    Math.min(max, CONVERSATION_DEFAULT_MAX_WIDTH),
    Math.max(min, width),
  );
};

export const createVisualWorkspaceState = (
  viewportWidth: number,
  viewportHeight = 0,
): VisualWorkspaceState => ({
  railHidden: false,
  conversation: {
    width: clampInitialConversationWidth(viewportWidth * 0.28, viewportWidth),
    // On screen: hiding the column is a presenting gesture the reviewer
    // makes, never a resting state a session opens into.
    hidden: false,
    unread: 0,
    // Every section open: the reviewer has not shut anything yet, and a stack
    // that opened closed would say nothing about what is in it.
    collapsed: [],
    changesHeight: 200,
    // Measured rather than taken from the design's 246: the composer, its
    // status row and the session's own button come to about 180, and a chat
    // section that fits them with no room left for the transcript pushes
    // `Return to agent` under the fold at rest.
    chatHeight: 300,
  },
  viewportWidth,
  viewportHeight,
  selectedSubject: null,
  descriptionExpanded: false,
  detailsOpen: false,
  bottomPanel: { open: false, tab: "view-query" },
  tree: { filterText: "", collapsed: [] },
  connection: null,
  draftingSubject: false,
  pendingDeletion: null,
  pendingViewDeletion: null,
  pendingViewRename: null,
  contextMenu: null,
  nesting: DEFAULT_NESTING,
  foldMode: DEFAULT_FOLD,
  folded: [],
  unfolded: [],
  direction: DEFAULT_DIRECTION,
  layout: "layered",
  showLifecycle: true,
  showEvidence: true,
  // This repo declares exactly one owner across all 102
  // `yarramate/ownership/owner` claims, so every chip would render
  // identically - uniform noise until real ownership diversity exists.
  showOwnership: false,
  // On by default: the chip is the canvas half of the interview (#292), and
  // it only draws where a count is non-zero, so a finished model stays calm.
  showNudges: true,
});

export const visualWorkspaceReducer = (
  state: VisualWorkspaceState,
  action: VisualWorkspaceAction,
): VisualWorkspaceState => {
  switch (action.type) {
    case "section.toggled": {
      const shut = state.conversation.collapsed.includes(action.section);
      return {
        ...state,
        conversation: {
          ...state.conversation,
          collapsed: shut
            ? state.conversation.collapsed.filter(
                (section) => section !== action.section,
              )
            : [...state.conversation.collapsed, action.section],
          // Opening chat is reading it, so the count it carried goes with the
          // reason it was there.
          unread:
            action.section === "chat" && shut ? 0 : state.conversation.unread,
        },
      };
    }
    case "section.resized": {
      const height = clampSectionHeight(action.height, state.viewportHeight);
      const key = action.section === "chat" ? "chatHeight" : "changesHeight";
      return state.conversation[key] === height
        ? state
        : {
            ...state,
            conversation: { ...state.conversation, [key]: height },
          };
    }
    case "conversation.resized": {
      // No separator is drawn against a hidden column, so a resize arriving
      // while hidden is a stray - and honouring it would make reopening
      // restore a width the reviewer never dragged to.
      if (state.conversation.hidden) return state;
      const width = clampConversationWidth(action.width, state.viewportWidth);
      return width === state.conversation.width
        ? state
        : { ...state, conversation: { ...state.conversation, width } };
    }
    case "rail.toggled":
      // Nothing to preserve on the way out and nothing to restore on the way
      // back: the rail is one fixed width, so hiding it is the whole state.
      return { ...state, railHidden: !state.railHidden };
    case "conversation.toggled": {
      const hidden = !state.conversation.hidden;
      return {
        ...state,
        conversation: {
          ...state.conversation,
          hidden,
          // Reopening puts chat back in front of the reviewer, so the count
          // goes the way it goes when the section itself is opened - unless
          // they had shut the section, where the arrival is still out of
          // sight and the count moves to the chat header instead.
          unread:
            !hidden && !state.conversation.collapsed.includes("chat")
              ? 0
              : state.conversation.unread,
        },
      };
    }
    case "viewport.resized": {
      const width = clampConversationWidth(
        state.conversation.width,
        action.viewportWidth,
      );
      const viewportHeight = action.viewportHeight ?? state.viewportHeight;
      const changesHeight = clampSectionHeight(
        state.conversation.changesHeight,
        viewportHeight,
      );
      const chatHeight = clampSectionHeight(
        state.conversation.chatHeight,
        viewportHeight,
      );
      return width === state.conversation.width &&
        changesHeight === state.conversation.changesHeight &&
        chatHeight === state.conversation.chatHeight &&
        action.viewportWidth === state.viewportWidth &&
        viewportHeight === state.viewportHeight
        ? state
        : {
            ...state,
            conversation: {
              ...state.conversation,
              width,
              changesHeight,
              chatHeight,
            },
            viewportWidth: action.viewportWidth,
            viewportHeight,
          };
    }
    case "attention.received":
      // Chat is on screen unless the reviewer shut it, so an arriving reply
      // needs no count to stand in for it. A shut section - or the whole
      // column hidden (#294) - is where something happened out of sight.
      return state.conversation.hidden ||
        state.conversation.collapsed.includes("chat")
        ? {
            ...state,
            conversation: {
              ...state.conversation,
              unread: state.conversation.unread + 1,
            },
          }
        : state;
    // A menu is dismissed by everything it can lead to, and by the commit that
    // can take its target away, rather than by a blanket rule over every
    // action: a reviewer who right-clicks and then reads an agent's reply
    // should still find the menu where they left it.
    case "menu.opened":
      return {
        ...state,
        contextMenu: { target: action.target, x: action.x, y: action.y },
      };
    case "menu.dismissed":
      return state.contextMenu === null
        ? state
        : { ...state, contextMenu: null };
    case "connection.started":
      return {
        ...state,
        connection: { from: action.from, to: null },
        draftingSubject: false,
        contextMenu: null,
      };
    case "connection.targeted":
      if (state.connection === null) return state;
      // Naming the source again means "not that after all". A subject related
      // to itself is a mis-click far more often than an intention, and the
      // table would offer `association` for it regardless, so the gesture is
      // better spent on the way out.
      return action.to === state.connection.from
        ? { ...state, connection: null }
        : { ...state, connection: { ...state.connection, to: action.to } };
    case "connection.cancelled":
      return state.connection === null ? state : { ...state, connection: null };
    case "subject.draft.opened":
      // The two tools are alternatives, not layers: opening one puts the other
      // away rather than leaving two half-finished drafts on screen.
      return {
        ...state,
        draftingSubject: true,
        connection: null,
        contextMenu: null,
      };
    case "subject.draft.closed":
      return state.draftingSubject ? { ...state, draftingSubject: false } : state;
    case "deletion.asked":
      // Asking puts the other tools away: a confirmation is the only thing
      // that should be able to take the next click.
      return {
        ...state,
        pendingDeletion: action.id,
        connection: null,
        draftingSubject: false,
        contextMenu: null,
      };
    case "deletion.dismissed":
      return state.pendingDeletion === null
        ? state
        : { ...state, pendingDeletion: null };
    case "viewDeletion.asked":
      return { ...state, pendingViewDeletion: action.id, contextMenu: null };
    case "viewDeletion.dismissed":
      return state.pendingViewDeletion === null
        ? state
        : { ...state, pendingViewDeletion: null };
    case "viewRename.asked":
      return { ...state, pendingViewRename: action.id, contextMenu: null };
    case "viewRename.dismissed":
      return state.pendingViewRename === null
        ? state
        : { ...state, pendingViewRename: null };
    case "subject.selected":
      return {
        ...state,
        // Selecting a subject opens the section that describes it, because
        // that is what the selection was for. Nothing else about the stack
        // moves - a reviewer who shut Changes did not ask for it back.
        conversation: {
          ...state.conversation,
          collapsed: state.conversation.collapsed.filter(
            (section) => section !== "properties",
          ),
        },
        selectedSubject: action.subject,
        descriptionExpanded: false,
        contextMenu: null,
      };
    case "subject.cleared":
      return state.selectedSubject === null
        ? state
        : { ...state, selectedSubject: null, descriptionExpanded: false };
    case "description.toggled":
      return state.selectedSubject === null
        ? state
        : { ...state, descriptionExpanded: !state.descriptionExpanded };
    case "details.toggled":
      return { ...state, detailsOpen: !state.detailsOpen };
    case "bottomPanel.toggled":
      return {
        ...state,
        bottomPanel: { ...state.bottomPanel, open: !state.bottomPanel.open },
      };
    case "bottomPanel.tabSelected":
      // Choosing a tab opens the panel: a reviewer who names a tab has asked
      // to read it, and a selection that left the panel shut would be a click
      // with nothing to show for it.
      return state.bottomPanel.open && state.bottomPanel.tab === action.tab
        ? state
        : { ...state, bottomPanel: { open: true, tab: action.tab } };
    case "tree.filtered":
      return state.tree.filterText === action.filterText
        ? state
        : { ...state, tree: { ...state.tree, filterText: action.filterText } };
    case "tree.toggled": {
      const shut = state.tree.collapsed.includes(action.key);
      return {
        ...state,
        tree: {
          ...state.tree,
          collapsed: shut
            ? state.tree.collapsed.filter((key) => key !== action.key)
            : [...state.tree.collapsed, action.key],
        },
      };
    }
    case "nesting.set":
      // Restating the same vocabulary is not a change. Every view states one,
      // so without this a view switch would produce a new state object each
      // time and every identity-based memo downstream would miss.
      return sameNesting(state.nesting, action.nesting)
        ? state
        : { ...state, nesting: action.nesting };
    case "fold.set": {
      // Same rule as `nesting.set`: restating what is already true must not
      // mint a new state object, or every identity memo downstream misses on
      // every view switch.
      const unchanged =
        state.foldMode === action.mode &&
        sameIds(state.folded, action.folded) &&
        sameIds(state.unfolded, action.unfolded);
      return unchanged
        ? state
        : {
            ...state,
            foldMode: action.mode,
            folded: action.folded,
            unfolded: action.unfolded,
          };
    }
    case "fold.toggled": {
      // A toggle MOVES the id between the two sets rather than flipping one
      // flag, because "the reader opened this" has to survive the view's
      // default being restated on the next view switch.
      const shut =
        state.folded.includes(action.id) ||
        (state.foldMode === "instances" && !state.unfolded.includes(action.id));
      return {
        ...state,
        folded: shut
          ? state.folded.filter((id) => id !== action.id)
          : [...state.folded.filter((id) => id !== action.id), action.id],
        unfolded: shut
          ? [...state.unfolded.filter((id) => id !== action.id), action.id]
          : state.unfolded.filter((id) => id !== action.id),
      };
    }
    case "fold.all":
      // A statement about the whole view, so nothing may be left holding an
      // opinion from before it.
      return action.folded
        ? { ...state, folded: [...action.ids], unfolded: [] }
        : { ...state, folded: [], unfolded: [...action.ids] };
    case "direction.set":
      // Restating the same direction is not a change, the rule `nesting.set`
      // states above: every view declares one, so without this a view switch
      // would mint a new state object and every identity memo downstream would
      // miss.
      return state.direction === action.direction
        ? state
        : { ...state, direction: action.direction };
    case "layout.set":
      return { ...state, layout: action.layout };
    case "presentation.toggled":
      return { ...state, [action.flag]: action.value };
    case "model.replaced": {
      // A menu is anchored to a pointer position over a subject that may not
      // have survived the commit. `contextMenuFor` would return an empty menu
      // for a target that is gone, so nothing stale is ever drawn — but a menu
      // floating over a canvas that just redrew under it is its own confusion.
      const base =
        state.contextMenu === null ? state : { ...state, contextMenu: null };
      const held = base.selectedSubject;
      if (held === null) return base;
      const graph = action.graph;
      const survivor =
        graph === null
          ? null
          : held.type === "element"
            ? nextElement(graph, held.id)
            : nextRelationship(graph, held.id);
      // A commit rewrites the whole model, but the reviewer's subject usually
      // survives it - re-read the same id rather than closing the inspector
      // under them. Only a subject the commit actually removed is dropped.
      return survivor === null
        ? { ...base, selectedSubject: null, descriptionExpanded: false }
        : { ...base, selectedSubject: survivor };
    }
  }
};

export const formatContextualQuestion = (
  question: string,
  subject: SelectedDiagramSubject | null,
): string => {
  const text = question.trim();
  if (subject === null) return text;
  if (subject.type === "element") {
    return `About element “${subject.title}” (${subject.id}): ${text}`;
  }
  const route = `${subject.sourceTitle} → ${subject.targetTitle}`;
  const name = subject.label === null ? route : `${route} — ${subject.label}`;
  return `About relationship “${name}”: ${text}`;
};
