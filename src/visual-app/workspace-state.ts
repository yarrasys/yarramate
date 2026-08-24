import type {
  CanvasEdge,
  CanvasGraph,
  CanvasNode,
} from "../graph-projection.js";
import { DEFAULT_NESTING, type NestingKind } from "../nesting.js";
import type { ContextMenuTarget } from "./context-menu-model.js";

export type ConversationMode = "auto" | "open" | "closed";

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

export const CONVERSATION_MIN_WIDTH = 320;
export const CONVERSATION_MAX_WIDTH = 640;
/** The share of the viewport the approved design lets the conversation take. */
const CONVERSATION_MAX_VIEWPORT_SHARE = 0.45;

export interface VisualWorkspaceState {
  readonly conversation: {
    readonly mode: ConversationMode;
    readonly width: number;
    readonly unread: number;
  };
  /**
   * The viewport this state was last clamped against. Presentation reads its
   * resize bounds from here rather than from `window`, so every viewport change
   * reaches the separator's reported minimum and maximum.
   */
  readonly viewportWidth: number;
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
  readonly descriptionExpanded: boolean;
  readonly detailsOpen: boolean;
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
   * What draws as nesting in the active view, in precedence order (ADR 0101).
   * A view that says nothing keeps `DEFAULT_NESTING`, which is composition
   * alone - the behaviour that shipped before a view could say.
   */
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
  readonly nesting: readonly NestingKind[];
  readonly layout: "layered";
  readonly showLifecycle: boolean;
  readonly showEvidence: boolean;
  readonly showOwnership: boolean;
}

export type VisualWorkspaceAction =
  | { readonly type: "conversation.toggled" }
  | { readonly type: "conversation.resized"; readonly width: number }
  | { readonly type: "viewport.resized"; readonly viewportWidth: number }
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
  | {
      readonly type: "subject.selected";
      readonly subject: SelectedDiagramSubject;
    }
  | { readonly type: "subject.cleared" }
  | { readonly type: "description.toggled" }
  | { readonly type: "details.toggled" }
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
      readonly type: "layout.set";
      readonly layout: "layered";
    }
  | {
      readonly type: "presentation.toggled";
      readonly flag: "showLifecycle" | "showEvidence" | "showOwnership";
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
): VisualWorkspaceState => ({
  conversation: {
    mode: "auto",
    width: clampInitialConversationWidth(viewportWidth * 0.28, viewportWidth),
    unread: 0,
  },
  viewportWidth,
  selectedSubject: null,
  descriptionExpanded: false,
  detailsOpen: false,
  tree: { filterText: "", collapsed: [] },
  connection: null,
  draftingSubject: false,
  pendingDeletion: null,
  contextMenu: null,
  nesting: DEFAULT_NESTING,
  layout: "layered",
  showLifecycle: true,
  showEvidence: true,
  // This repo declares exactly one owner across all 102
  // `yarramate/ownership/owner` claims, so every chip would render
  // identically - uniform noise until real ownership diversity exists.
  showOwnership: false,
});

export const visualWorkspaceReducer = (
  state: VisualWorkspaceState,
  action: VisualWorkspaceAction,
): VisualWorkspaceState => {
  switch (action.type) {
    case "conversation.toggled": {
      const mode = state.conversation.mode === "open" ? "closed" : "open";
      return {
        ...state,
        conversation: {
          ...state.conversation,
          mode,
          unread: mode === "open" ? 0 : state.conversation.unread,
        },
      };
    }
    case "conversation.resized": {
      const width = clampConversationWidth(action.width, state.viewportWidth);
      return width === state.conversation.width
        ? state
        : { ...state, conversation: { ...state.conversation, width } };
    }
    case "viewport.resized": {
      const width = clampConversationWidth(
        state.conversation.width,
        action.viewportWidth,
      );
      return width === state.conversation.width &&
        action.viewportWidth === state.viewportWidth
        ? state
        : {
            ...state,
            conversation: { ...state.conversation, width },
            viewportWidth: action.viewportWidth,
          };
    }
    case "attention.received":
      if (state.conversation.mode === "open") return state;
      if (state.conversation.mode === "auto") {
        return {
          ...state,
          conversation: { ...state.conversation, mode: "open", unread: 0 },
        };
      }
      return {
        ...state,
        conversation: {
          ...state.conversation,
          unread: state.conversation.unread + 1,
        },
      };
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
    case "subject.selected":
      return {
        ...state,
        conversation: { ...state.conversation, mode: "open", unread: 0 },
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
