import type { CanvasEdge, CanvasNode } from '../graph-projection.js'

export type ConversationMode = 'auto' | 'open' | 'closed'

export interface SelectedElement {
  readonly type: 'element'
  readonly id: string
  readonly title: string
  readonly kind: string
  readonly description: string | null
}

export interface SelectedRelationship {
  readonly type: 'relationship'
  readonly id: string
  readonly sourceId: string
  readonly sourceTitle: string
  readonly targetId: string
  readonly targetTitle: string
  readonly label: string | null
  readonly description: string | null
  readonly kind: string
}

export type SelectedDiagramSubject = SelectedElement | SelectedRelationship

const optionalText = (value: string | null | undefined): string | null => {
  const text = value?.trim() ?? ''
  return text === '' ? null : text
}

export const normalizeSelectedElement = (
  node: CanvasNode,
): SelectedElement => ({
  type: 'element',
  id: node.id,
  title: node.name,
  kind: node.kindLabel,
  description: optionalText(node.description),
})

export const normalizeSelectedRelationship = (
  edge: CanvasEdge,
  nodeTitles: ReadonlyMap<string, string>,
): SelectedRelationship => {
  const sourceId = edge.from
  const targetId = edge.to
  return {
    type: 'relationship',
    id: edge.id,
    sourceId,
    sourceTitle: nodeTitles.get(sourceId) ?? sourceId,
    targetId,
    targetTitle: nodeTitles.get(targetId) ?? targetId,
    label: optionalText(edge.name),
    description: optionalText(edge.description),
    kind: edge.kindLabel,
  }
}

export const CONVERSATION_MIN_WIDTH = 320
export const CONVERSATION_MAX_WIDTH = 640
/** The share of the viewport the approved design lets the conversation take. */
const CONVERSATION_MAX_VIEWPORT_SHARE = 0.45

export interface VisualWorkspaceState {
  readonly conversation: {
    readonly mode: ConversationMode
    readonly width: number
    readonly unread: number
  }
  /**
   * The viewport this state was last clamped against. Presentation reads its
   * resize bounds from here rather than from `window`, so every viewport change
   * reaches the separator's reported minimum and maximum.
   */
  readonly viewportWidth: number
  readonly selectedSubject: SelectedDiagramSubject | null
  readonly descriptionExpanded: boolean
  readonly detailsOpen: boolean
}

export type VisualWorkspaceAction =
  | { readonly type: 'conversation.toggled' }
  | { readonly type: 'conversation.resized'; readonly width: number }
  | { readonly type: 'viewport.resized'; readonly viewportWidth: number }
  | { readonly type: 'attention.received' }
  | { readonly type: 'subject.selected'; readonly subject: SelectedDiagramSubject }
  | { readonly type: 'subject.cleared' }
  | { readonly type: 'description.toggled' }
  | { readonly type: 'details.toggled' }
  | { readonly type: 'model.replaced' }

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
})

const clampConversationWidth = (width: number, viewportWidth: number) => {
  const { min, max } = conversationWidthBounds(viewportWidth)
  return Math.min(max, Math.max(min, width))
}

// Initial width follows `clamp(320px, 28vw, 480px)` per the approved design;
// only a manual drag may widen the panel up to CONVERSATION_MAX_WIDTH (640).
const CONVERSATION_DEFAULT_MAX_WIDTH = 480

const clampInitialConversationWidth = (
  width: number,
  viewportWidth: number,
) => {
  const { min, max } = conversationWidthBounds(viewportWidth)
  return Math.min(Math.min(max, CONVERSATION_DEFAULT_MAX_WIDTH), Math.max(min, width))
}

export const createVisualWorkspaceState = (
  viewportWidth: number,
): VisualWorkspaceState => ({
  conversation: {
    mode: 'auto',
    width: clampInitialConversationWidth(viewportWidth * 0.28, viewportWidth),
    unread: 0,
  },
  viewportWidth,
  selectedSubject: null,
  descriptionExpanded: false,
  detailsOpen: false,
})

export const visualWorkspaceReducer = (
  state: VisualWorkspaceState,
  action: VisualWorkspaceAction,
): VisualWorkspaceState => {
  switch (action.type) {
    case 'conversation.toggled': {
      const mode = state.conversation.mode === 'open' ? 'closed' : 'open'
      return {
        ...state,
        conversation: {
          ...state.conversation,
          mode,
          unread: mode === 'open' ? 0 : state.conversation.unread,
        },
      }
    }
    case 'conversation.resized': {
      const width = clampConversationWidth(action.width, state.viewportWidth)
      return width === state.conversation.width
        ? state
        : { ...state, conversation: { ...state.conversation, width } }
    }
    case 'viewport.resized': {
      const width = clampConversationWidth(
        state.conversation.width,
        action.viewportWidth,
      )
      return width === state.conversation.width &&
        action.viewportWidth === state.viewportWidth
        ? state
        : {
            ...state,
            conversation: { ...state.conversation, width },
            viewportWidth: action.viewportWidth,
          }
    }
    case 'attention.received':
      if (state.conversation.mode === 'open') return state
      if (state.conversation.mode === 'auto') {
        return {
          ...state,
          conversation: { ...state.conversation, mode: 'open', unread: 0 },
        }
      }
      return {
        ...state,
        conversation: {
          ...state.conversation,
          unread: state.conversation.unread + 1,
        },
      }
    case 'subject.selected':
      return {
        ...state,
        conversation: { ...state.conversation, mode: 'open', unread: 0 },
        selectedSubject: action.subject,
        descriptionExpanded: false,
      }
    case 'subject.cleared':
      return state.selectedSubject === null
        ? state
        : { ...state, selectedSubject: null, descriptionExpanded: false }
    case 'description.toggled':
      return state.selectedSubject === null
        ? state
        : { ...state, descriptionExpanded: !state.descriptionExpanded }
    case 'details.toggled':
      return { ...state, detailsOpen: !state.detailsOpen }
    case 'model.replaced':
      return state.selectedSubject === null
        ? state
        : { ...state, selectedSubject: null, descriptionExpanded: false }
  }
}

export const formatContextualQuestion = (
  question: string,
  subject: SelectedDiagramSubject | null,
): string => {
  const text = question.trim()
  if (subject === null) return text
  if (subject.type === 'element') {
    return `About element "${subject.title}" (${subject.id}): ${text}`
  }
  const route = `${subject.sourceTitle} → ${subject.targetTitle}`
  const name = subject.label === null ? route : `${route} — ${subject.label}`
  return `About relationship "${name}": ${text}`
}
