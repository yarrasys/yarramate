import { GraphCanvas } from "./graph-canvas.js";
import { FilterPanel, type PresentationFlag } from "./filter-panel.js";
import { QuickFilterBox } from "./quick-filter.js";
import { ViewTree } from "./view-tree.js";
import { SaveViewControl } from "./save-view.js";
import { describeQuery } from "./describe-query.js";
import { ChangesetTray } from "./changeset-tray.js";
import { ConceptForm, RelationshipForm } from "./subject-form.js";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { NestingKind } from "../nesting.js";
import type { ProjectionQuery } from "../projection.js";
import type { VisualRenderedModel } from "../adapters/visual/wire.js";
import type { YarramateOperation } from "../operations.js";
import type {
  VisualChoicePresentPayload,
  VisualDiagnostic,
  VisualLayoutSavePayload,
  VisualViewOperation,
  VisualViewSummary,
} from "../adapters/visual/protocol-contract.js";
import { useVisualSession } from "./session-client.js";
import { activeViewMembership } from "./state.js";
import type { VisualAppRecord, VisualAppState } from "./state.js";
import {
  conversationWidthBounds,
  createVisualWorkspaceState,
  formatContextualQuestion,
  normalizeSelectedElement,
  normalizeSelectedRelationship,
  presentationActionsFor,
  viewNeedingApplication,
  visualWorkspaceReducer,
  type ConnectionDraft,
  type SelectedDiagramSubject,
} from "./workspace-state.js";
import { ConnectionPanel } from "./connection-panel.js";
import { faultedSubjects } from "./faults.js";
import { SubjectDraftPanel } from "./subject-draft-panel.js";
import { ConfirmDialog } from "./confirm-dialog.js";
import { PromptDialog } from "./prompt-dialog.js";
import {
  directoryOf,
  duplicateView,
  renameView,
} from "../adapters/visual/view-identity.js";
import { ContextMenu } from "./context-menu.js";
import {
  contextMenuFor,
  type ContextMenuIntent,
  type ContextMenuTarget,
} from "./context-menu-model.js";
import { stageRelationshipScalarChange } from "./subject-form.js";
import { describeDeletion, draftDeletion } from "../deletion-drafting.js";

/**
 * A drawing board, not a document: the diagram holds the workspace, one compact
 * strip carries the facts and the controls above it, and the conversation is a
 * panel the reviewer sizes or puts away without losing what it holds.
 */

const SPEAKERS: Readonly<Record<VisualAppRecord["speaker"], string>> = {
  reviewer: "You",
  agent: "Agent",
  session: "Session",
};

const STATUS_WORDS: Readonly<
  Record<"thinking" | "compiling" | "waiting" | "idle", string>
> = {
  thinking: "Agent is thinking",
  compiling: "Agent is compiling the model",
  waiting: "Agent is waiting",
  idle: "Agent is idle",
};

const connectionOf = (state: VisualAppState, connected: boolean): string => {
  switch (state.lifecycle) {
    case "connecting":
      return "Opening";
    case "active":
      return connected ? "Live" : "Reconnecting";
    case "ending":
      return "Ending";
    case "disconnected":
      return "Reconnecting";
    case "closed":
      return "Closed";
  }
};

const endTransitionStatus = (state: VisualAppState): string => {
  if (state.lifecycle === "closed") {
    return "Visual conversation ended. Continue in the main agent.";
  }
  if (state.lifecycle !== "ending") return "";
  if (state.handoff !== null) {
    return "Handoff ready — returning control to the main agent.";
  }
  return "Ending conversation — preparing a handoff for the main agent.";
};

const CommandStrip = ({
  state,
  connection,
  detailsOpen,
  conversationOpen,
  unread,
  layout,
  views,
  onToggleDetails,
  onToggleConversation,
  onSelectLayout,
  showLifecycle,
  showEvidence,
  showOwnership,
  onTogglePresentation,
  onApplyFilter,
  quickFilterText,
  onQuickFilterChange,
  saveViewOpen,
  saveViewDirectory,
  onToggleSaveView,
  onStageView,
  onEnd,
}: {
  readonly state: VisualAppState;
  readonly connection: string;
  readonly detailsOpen: boolean;
  readonly conversationOpen: boolean;
  readonly unread: number;
  readonly layout: "layered";
  readonly views: readonly VisualViewSummary[];
  readonly onToggleDetails: () => void;
  readonly onToggleConversation: () => void;
  readonly onSelectLayout: (layout: "layered") => void;
  readonly showLifecycle: boolean;
  readonly showEvidence: boolean;
  readonly showOwnership: boolean;
  readonly onTogglePresentation: (
    flag: PresentationFlag,
    value: boolean,
  ) => void;
  readonly onApplyFilter: (query: ProjectionQuery) => void;
  readonly quickFilterText: string;
  readonly onQuickFilterChange: (text: string) => void;
  readonly saveViewOpen: boolean;
  readonly saveViewDirectory: string | undefined;
  readonly onToggleSaveView: () => void;
  readonly onStageView: (operation: VisualViewOperation) => void;
  readonly onEnd: () => void;
}) => (
  <header className="command-strip">
    <div className="command-identity">
      <h1>{state.title === "" ? "Opening the session" : state.title}</h1>
      <span className="beta-badge">Beta</span>
      <span className="authority">Checked YarraMate model</span>
      <span className="connection-state" role="status">
        {connection}
      </span>
    </div>
    <div className="command-actions">
      <span
        className="end-transition-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {endTransitionStatus(state)}
      </span>
      <QuickFilterBox value={quickFilterText} onChange={onQuickFilterChange} />
      <FilterPanel
        query={state.activeFilter?.query ?? null}
        onApply={onApplyFilter}
        showLifecycle={showLifecycle}
        showEvidence={showEvidence}
        showOwnership={showOwnership}
        onTogglePresentation={onTogglePresentation}
      />
      <SaveViewControl
        views={views}
        activeViewId={state.activeView}
        query={state.activeFilter?.query ?? null}
        layout={layout}
        showLifecycle={showLifecycle}
        showEvidence={showEvidence}
        showOwnership={showOwnership}
        open={saveViewOpen}
        directory={saveViewDirectory}
        onToggle={onToggleSaveView}
        onStage={onStageView}
      />
      <button
        type="button"
        aria-expanded={detailsOpen}
        aria-controls="session-details"
        onClick={onToggleDetails}
      >
        Details
      </button>
      <button
        type="button"
        aria-expanded={conversationOpen}
        aria-controls="conversation-panel"
        onClick={onToggleConversation}
      >
        Conversation
        {unread === 0 ? null : (
          <span className="attention-count">{unread}</span>
        )}
      </button>
      <button
        type="button"
        className="end-session"
        onClick={onEnd}
        disabled={state.lifecycle !== "active"}
      >
        {state.lifecycle === "ending" || state.lifecycle === "closed"
          ? "Ending…"
          : "End"}
      </button>
    </div>
    {/* Static prose is not worth the canvas: the disclosure is laid over the
        workspace from the strip rather than taking a row of its own, so opening
        it never reflows the diagram or the conversation. */}
    <div id="session-details" className="session-details" hidden={!detailsOpen}>
      <p>{state.description}</p>
      <button type="button" className="details-close" onClick={onToggleDetails}>
        Close details
      </button>
    </div>
  </header>
);


const Choices = ({
  choices,
  disabled,
  onChoice,
}: {
  readonly choices: VisualChoicePresentPayload;
  readonly disabled: boolean;
  readonly onChoice: (optionId: string) => void;
}) => (
  <div className="choices">
    <p className="question">{choices.question}</p>
    <ul>
      {choices.options.map((option) => (
        <li key={option.id}>
          <button
            type="button"
            onClick={() => onChoice(option.id)}
            disabled={disabled}
          >
            <span className="label">{option.label}</span>
            {option.description === undefined ? null : (
              <span className="detail">{option.description}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  </div>
);
/**
 * The server's own refusals of a browser frame (`YMVS...`). These are about the
 * frame rather than about a subject, so they carry no `subjects` and there is
 * nothing on the diagram to mark. A refused COMMIT is a different thing and
 * lands in the changeset tray, where what it names is counted and marked
 * (ADR 0102).
 */
const Faults = ({
  diagnostics,
}: {
  readonly diagnostics: readonly VisualDiagnostic[];
}) =>
  diagnostics.length === 0 ? null : (
    <div className="faults" role="alert">
      <p className="faults-title">
        The last change did not compile. The diagram still shows the model that
        did.
      </p>
      <ul>
        {diagnostics.map((diagnostic) => (
          <li key={`${diagnostic.code}-${diagnostic.pointer}`}>
            <span className="code">{diagnostic.code}</span> {diagnostic.message}
            <span className="where">
              {diagnostic.path}:{diagnostic.line}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

const DiagramWorkspace = ({
  state,
  selectedId,
  waiting,
  layout,
  nesting,
  showLifecycle,
  showEvidence,
  showOwnership,
  connection,
  onConnectTarget,
  onConnectCancel,
  onConnectStage,
  onDraftStage,
  draftingSubject,
  onDraftSubject,
  onDraftSubjectClose,
  pendingDeletion,
  onDeletionDismiss,
  onSelect,
  onCanvasMenu,
  onClearFilter,
  onSaveLayout,
  onCanvasReady,
}: {
  readonly state: VisualAppState;
  readonly selectedId: string | null;
  readonly waiting: string | null;
  readonly layout: "layered";
  readonly nesting: readonly NestingKind[];
  readonly showLifecycle: boolean;
  readonly showEvidence: boolean;
  readonly showOwnership: boolean;
  readonly connection: ConnectionDraft | null;
  readonly onConnectTarget: (id: string) => void;
  readonly onConnectCancel: () => void;
  readonly onConnectStage: (operation: YarramateOperation) => void;
  /**
   * Staging for a subject the reviewer is CREATING, which is not the same
   * motion as staging a relationship or a deletion: a created subject also
   * joins the view that created it (#255).
   */
  readonly onDraftStage: (operation: YarramateOperation) => void;
  readonly draftingSubject: boolean;
  readonly onDraftSubject: () => void;
  readonly onDraftSubjectClose: () => void;
  readonly pendingDeletion: string | null;
  readonly onDeletionDismiss: () => void;
  readonly onSelect: (subject: SelectedDiagramSubject) => void;
  readonly onCanvasMenu: (
    target: {
      readonly type: "node" | "edge" | "canvas";
      readonly id: string | null;
    },
    position: { readonly x: number; readonly y: number },
  ) => void;
  readonly onClearFilter: () => void;
  readonly onSaveLayout: (payload: VisualLayoutSavePayload) => void;
  readonly onCanvasReady: (png: (() => string) | null) => void;
}) => {
  // An edge names its endpoints by node id; the reviewer reads titles. The
  // rendering model the renderer itself draws answers that, so nothing here
  // reaches into the compiled document.
  const nodeTitles = useMemo(
    () =>
      new Map(
        (state.model?.graph.nodes ?? []).map(
          (node) => [node.id, node.name] as const,
        ),
      ),
    [state.model],
  );

  return (
    <section className="diagram-workspace" aria-label="Architecture diagram">
      {/*
       * A view's own query is named by the tree, so a pill would repeat it.
       * Every other standing filter has nothing else naming it - the panel can
       * be collapsed and chat can be scrolled away - so the canvas would show a
       * subset while every control claimed the whole model.
       */}
      {state.activeFilter !== null && state.activeFilter.source !== "view" ? (
        <div className="filter-pill" role="status">
          <span>
            Filtered by {state.activeFilter.source}:{" "}
            <code>{describeQuery(state.activeFilter.query)}</code>
          </span>
          <button type="button" onClick={onClearFilter}>
            Show all
          </button>
        </div>
      ) : null}
      <div className="canvas">
        {state.model === null ? null : (
          <button
            type="button"
            className="subject-draft-open"
            onClick={onDraftSubject}
          >
            Add subject
          </button>
        )}
        {!draftingSubject || state.model === null ? null : (
          <SubjectDraftPanel
            graph={state.model.graph}
            kinds={state.model.vocabulary.conceptKinds}
            documents={state.model.documents}
            defaultDocument={
              // Near what the reviewer is looking at: the selected subject's
              // document, or the first the workspace declares.
              (selectedId === null
                ? undefined
                : state.model.graph.nodes.find(
                    (node) => node.id === selectedId,
                  )?.document) ??
              state.model.documents[0] ??
              ""
            }
            onStage={onDraftStage}
            onCancel={onDraftSubjectClose}
          />
        )}
        {pendingDeletion === null || state.model === null ? null : (
          <ConfirmDialog
            title="Delete"
            message={
              describeDeletion(state.model.graph, pendingDeletion) ??
              "That subject is no longer on the diagram."
            }
            confirmLabel="Delete"
            cancelLabel="Keep"
            onConfirm={() => {
              // One batch: a subject and the relationships naming it have to
              // go together or `apply` refuses the lot (ADR 0069).
              for (const operation of draftDeletion(
                state.model!.graph,
                pendingDeletion,
              )) {
                onConnectStage(operation);
              }
              onDeletionDismiss();
            }}
            onCancel={onDeletionDismiss}
          />
        )}
        {connection === null || state.model === null ? null : (
          <ConnectionPanel
            draft={connection}
            graph={state.model.graph}
            onStage={onConnectStage}
            onCancel={onConnectCancel}
          />
        )}
        {state.model === null ? null : (
          <GraphCanvas
            graph={state.model.graph}
            selectedId={selectedId}
            onSelect={(id, type) => {
              const graph = state.model!.graph;
              if (type === "node") {
                // While a relationship is being drawn, naming a subject means
                // "connect to that", not "inspect that". Selection resumes as
                // soon as the draft is resolved or cancelled.
                if (connection !== null) {
                  onConnectTarget(id);
                  return;
                }
                const node = graph.nodes.find((n) => n.id === id);
                if (node !== undefined)
                  onSelect(normalizeSelectedElement(node));
              } else {
                const edge = graph.edges.find((e) => e.id === id);
                if (edge !== undefined)
                  onSelect(normalizeSelectedRelationship(edge, nodeTitles));
              }
            }}
            onContextMenu={onCanvasMenu}
            matchedIds={state.activeFilter?.matchedIds ?? null}
            quickFilterText={state.quickFilterText}
            nesting={nesting}
            faultedIds={faultedSubjects(state.commitDiagnostics ?? [])}
            showLifecycle={showLifecycle}
            showEvidence={showEvidence}
            showOwnership={showOwnership}
            activeViewId={state.activeView}
            savedPositions={state.model.layouts[state.activeView]}
            onSaveLayout={onSaveLayout}
            onCanvasReady={onCanvasReady}
          />
        )}
        {state.layoutNotice === null ? null : (
          <div className="layout-notice-pill" role="status">
            <span>{state.layoutNotice}</span>
          </div>
        )}
        {waiting === null ? null : <p className="waiting">{waiting}</p>}
      </div>
    </section>
  );
};

/**
 * A description is worth reading in full and worth not burying the rest of the
 * panel under. Three lines are the default; the disclosure appears only when
 * the browser actually clipped something, measured rather than guessed, because
 * panel width and font metrics both move.
 */
const ExpandableDescription = ({
  text,
  expanded,
  onToggle,
}: {
  readonly text: string | null;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) => {
  const description = text ?? "No description declared in this model";
  const body = useRef<HTMLParagraphElement>(null);
  const [canExpand, setCanExpand] = useState(false);

  useLayoutEffect(() => {
    const element = body.current;
    if (element === null || expanded) return;
    const measure = () =>
      setCanExpand(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [description, expanded]);

  return (
    <div className="subject-description">
      <p
        ref={body}
        className={expanded ? "description-expanded" : "description-clamped"}
      >
        {description}
      </p>
      {canExpand || expanded ? (
        <button type="button" aria-expanded={expanded} onClick={onToggle}>
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
};

/**
 * What the reviewer clicked, said back to them in the model's own words: the
 * facts the diagram cannot fit, and nothing the renderer would have to be
 * trusted to render.
 */
const SelectedSubjectInspector = ({
  subject,
  model,
  operations,
  expanded,
  onToggleDescription,
  onClear,
  onConnect,
  onDelete,
  onStageChange,
}: {
  readonly subject: SelectedDiagramSubject;
  readonly model: VisualRenderedModel;
  readonly operations: readonly YarramateOperation[];
  readonly expanded: boolean;
  readonly onToggleDescription: () => void;
  readonly onClear: () => void;
  readonly onConnect: (from: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onStageChange: (operation: YarramateOperation) => void;
}) => {
  const node =
    subject.type === "element"
      ? model.graph.nodes.find((candidate) => candidate.id === subject.id)
      : undefined;
  const edge =
    subject.type === "relationship"
      ? model.graph.edges.find((candidate) => candidate.id === subject.id)
      : undefined;

  return (
    <section className="subject-inspector" aria-labelledby="subject-heading">
      <div className="subject-heading-row">
        <div>
          <p className="subject-type">
            {subject.type === "element"
              ? "Selected element"
              : "Selected relationship"}
          </p>
          <h2 id="subject-heading">
            {subject.type === "element"
              ? subject.title
              : `${subject.sourceTitle} → ${subject.targetTitle}`}
          </h2>
        </div>
        {subject.type === "element" ? (
          <button
            type="button"
            className="subject-connect"
            onClick={() => onConnect(subject.id)}
          >
            Connect
          </button>
        ) : null}
        <button
          type="button"
          className="subject-delete"
          onClick={() => onDelete(subject.id)}
        >
          Delete
        </button>
        <button type="button" className="subject-clear" onClick={onClear}>
          Clear
        </button>
      </div>

      {node !== undefined ? (
        <ConceptForm
          node={node}
          model={model}
          operations={operations}
          onStageChange={onStageChange}
        />
      ) : null}
      {edge !== undefined ? (
        <RelationshipForm
          edge={edge}
          model={model}
          operations={operations}
          onStageChange={onStageChange}
        />
      ) : null}

      <ExpandableDescription
        text={subject.description}
        expanded={expanded}
        onToggle={onToggleDescription}
      />
    </section>
  );
};

const ConversationPanel = ({
  state,
  hidden,
  disabled,
  selectedSubject,
  descriptionExpanded,
  onSend,
  onChoice,
  onToggleDescription,
  onClearSubject,
  onConnect,
  onDelete,
  onDiscardChange,
  onStageChange,
  onClearChangeset,
  onUndoChangeset,
  onRedoChangeset,
  onCommitChangeset,
}: {
  readonly state: VisualAppState;
  readonly hidden: boolean;
  readonly disabled: boolean;
  readonly selectedSubject: SelectedDiagramSubject | null;
  readonly descriptionExpanded: boolean;
  readonly onSend: (text: string) => void;
  readonly onChoice: (optionId: string) => void;
  readonly onToggleDescription: () => void;
  readonly onClearSubject: () => void;
  readonly onConnect: (from: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onDiscardChange: (index: number) => void;
  readonly onStageChange: (operation: YarramateOperation) => void;
  readonly onClearChangeset: () => void;
  readonly onUndoChangeset: () => void;
  readonly onRedoChangeset: () => void;
  readonly onCommitChangeset: () => void;
}) => {
  const [draft, setDraft] = useState("");
  const agentWaiting = state.lifecycle === "active" && state.awaitingAgent;
  const visibleAgentStatus =
    state.lifecycle === "active" ? state.agentStatus : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text === "" || disabled) return;
    onSend(text);
    setDraft("");
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <section
      id="conversation-panel"
      className="talk"
      aria-label="Conversation"
      hidden={hidden}
    >
      <div className="conversation-scroll">
        {selectedSubject === null || state.model === null ? null : (
          <SelectedSubjectInspector
            subject={selectedSubject}
            model={state.model}
            operations={state.pendingChangeset.operations}
            expanded={descriptionExpanded}
            onToggleDescription={onToggleDescription}
            onClear={onClearSubject}
            onConnect={onConnect}
            onDelete={onDelete}
            onStageChange={onStageChange}
          />
        )}

        <ChangesetTray
          state={state}
          onDiscardChange={onDiscardChange}
          onClearChangeset={onClearChangeset}
          onUndoChangeset={onUndoChangeset}
          onRedoChangeset={onRedoChangeset}
          onCommitChangeset={onCommitChangeset}
        />

        <ol className="ledger" role="log" aria-live="polite">
          {state.transcript.length === 0 ? (
            <li className="empty">
              <p>Nothing asked yet. Question anything on the diagram.</p>
            </li>
          ) : (
            state.transcript.map((record) => (
              <li key={record.id} className={`said said-${record.speaker}`}>
                <p className="who">{SPEAKERS[record.speaker]}</p>
                <p className="words">{record.text}</p>
              </li>
            ))
          )}
        </ol>

        <Faults diagnostics={state.diagnostics} />

        {state.choices === null ? null : (
          <Choices
            choices={state.choices}
            disabled={disabled}
            onChoice={onChoice}
          />
        )}
      </div>

      <form className="composer" onSubmit={submit}>
        {selectedSubject === null ? null : (
          <div className="subject-chip">
            <span>
              {selectedSubject.type === "element"
                ? selectedSubject.title
                : `${selectedSubject.sourceTitle} → ${selectedSubject.targetTitle}`}
            </span>
            <button
              type="button"
              aria-label="Remove selected diagram context"
              onClick={onClearSubject}
            >
              Remove
            </button>
          </div>
        )}
        <label className="offscreen" htmlFor="composer-text">
          Ask about this design
        </label>
        <textarea
          id="composer-text"
          name="question"
          rows={3}
          value={draft}
          disabled={disabled}
          placeholder={
            !state.chatEnabled
              ? "This session is read-only"
              : selectedSubject?.type === "element"
                ? "Ask about this element"
                : selectedSubject?.type === "relationship"
                  ? "Ask about this relationship"
                  : "Ask about this design"
          }
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={keyDown}
        />
        <div className="composer-foot">
          <p
            className="agent-status"
            role="status"
            aria-live="polite"
            aria-busy={agentWaiting}
          >
            {agentWaiting ? (
              <span className="agent-spinner" aria-hidden="true" />
            ) : null}
            <span>
              {visibleAgentStatus === null
                ? agentWaiting
                  ? "Awaiting agent response"
                  : "\u00a0"
                : (STATUS_WORDS[visibleAgentStatus.state] ?? "\u00a0")}
            </span>
          </p>
          <button type="submit" disabled={disabled || draft.trim() === ""}>
            Send
          </button>
        </div>
      </form>
    </section>
  );
};

const ConversationSeparator = ({
  width,
  viewportWidth,
  onResize,
}: {
  readonly width: number;
  readonly viewportWidth: number;
  readonly onResize: (width: number) => void;
}) => {
  // From the state the reducer clamped against, never from `window`: a resize
  // that leaves the panel width alone still changes what this may be dragged
  // to, and a render that read the live global would only say so by accident.
  const bounds = conversationWidthBounds(viewportWidth);
  const drag = useRef<{
    readonly pointerId: number;
    readonly startX: number;
    readonly startWidth: number;
  } | null>(null);
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    onResize(active.startWidth + active.startX - event.clientX);
  };
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? 32 : 8;
    onResize(width + (event.key === "ArrowLeft" ? step : -step));
  };
  return (
    <div
      className="conversation-separator"
      role="separator"
      aria-label="Resize conversation"
      aria-orientation="vertical"
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onKeyDown={keyDown}
    />
  );
};

export const App = () => {
  const {
    state,
    connected,
    ask,
    choose,
    navigate,
    filter,
    clearFilter,
    setQuickFilterText,
    stageViewChange,
    stageViewMembership,
    saveLayout,
    discardChange,
    stageChange,
    clearChangeset,
    undoChangeset,
    redoChangeset,
    commitChangeset,
    end,
  } = useVisualSession();

  const [workspace, dispatchWorkspace] = useReducer(
    visualWorkspaceReducer,
    window.innerWidth,
    createVisualWorkspaceState,
  );

  const [layoutWaiting, setLayoutWaiting] = useState<string | null>(null);
  // The save-view form has two openers now — its own toggle in the strip and
  // the tree's new-view button — so the shell owns whether it is open.
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  // Which folder a new view is saved into. Set by "New view in this folder…"
  // and cleared by every other opener, so the default directory is what a
  // plain "New view…" gets.
  const [saveViewDirectory, setSaveViewDirectory] = useState<
    string | undefined
  >(undefined);
  // A way to photograph the canvas, handed up by `GraphCanvas` while one
  // exists. A ref rather than state: nothing renders differently because of
  // it, and a menu item reads it at the moment it is chosen.
  const canvasPngRef = useRef<(() => string) | null>(null);

  useEffect(() => {
    const resized = () =>
      dispatchWorkspace({
        type: "viewport.resized",
        viewportWidth: window.innerWidth,
      });
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);

  // Applying a view is one job with two triggers - the tree, and the view
  // the session opens on - so it runs here rather than in the tree's
  // handler, which the server-chosen opening never passes through. The ref
  // records what has already landed, so a reviewer-driven navigate (which
  // moves `activeView` synchronously) is applied exactly once, and clearing
  // back to "All" re-arms the view the reviewer left.
  const appliedViewRef = useRef<string | null>(null);
  useEffect(() => {
    if (state.activeView === "") {
      appliedViewRef.current = null;
      return;
    }
    const view = viewNeedingApplication(
      state.activeView,
      state.views,
      appliedViewRef.current,
      connected,
    );
    if (view === null) return;
    appliedViewRef.current = view.id;
    filter(view.query, "view");
    for (const action of presentationActionsFor(view.presentation)) {
      dispatchWorkspace(action);
    }
  }, [state.activeView, state.views, connected, filter]);

  // Only what arrived from the agent counts as attention: everything the
  // reviewer did themselves is already in front of them.
  const attention = useRef({
    transcriptLength: state.transcript.length,
    choices: state.choices,
    diagnostics: state.diagnostics,
  });

  useEffect(() => {
    const previous = attention.current;
    let receivedTranscript = false;
    for (
      let index = previous.transcriptLength;
      index < state.transcript.length;
      index += 1
    ) {
      if (state.transcript[index]?.speaker === "agent") {
        receivedTranscript = true;
        break;
      }
    }
    const received =
      receivedTranscript ||
      (state.choices !== null && state.choices !== previous.choices) ||
      (state.diagnostics.length > 0 &&
        state.diagnostics !== previous.diagnostics);
    attention.current = {
      transcriptLength: state.transcript.length,
      choices: state.choices,
      diagnostics: state.diagnostics,
    };
    if (received) dispatchWorkspace({ type: "attention.received" });
  }, [state.transcript.length, state.choices, state.diagnostics]);

  // A commit or a promotion replaces the whole model. The workspace re-reads the
  // held subject from the new graph rather than assuming it is gone; views and
  // lifecycle change under the same model and must leave the selection alone.
  const activeCandidate = useRef(state.model);
  useEffect(() => {
    if (state.model !== activeCandidate.current) {
      activeCandidate.current = state.model;
      dispatchWorkspace({
        type: "model.replaced",
        graph: state.model?.graph ?? null,
      });
    }
  }, [state.model]);

  // "No model to draw" is only true before anything has arrived; once a
  // model exists, `waiting` reflects the canvas's own busy state (e.g. a
  // `force` layout's two-pass run) instead of always being null.
  const waiting =
    state.model !== null
      ? layoutWaiting
      : state.lifecycle === "connecting"
        ? "Reading the session"
        : "No model to draw";

  const conversationOpen = workspace.conversation.mode === "open";
  const treeCollapsed = useMemo(
    () => new Set(workspace.tree.collapsed),
    [workspace.tree.collapsed],
  );
  const shellStyle = {
    "--conversation-width": `${workspace.conversation.width}px`,
  } as CSSProperties;

  const openMenu = (
    target: ContextMenuTarget,
    position: { readonly x: number; readonly y: number },
  ) =>
    dispatchWorkspace({
      type: "menu.opened",
      target,
      x: position.x,
      y: position.y,
    });

  // The menu is rebuilt from the live model on every render rather than
  // captured when it opened, so a commit landing underneath it cannot leave
  // items pointing at a subject that has gone.
  const menuGroups =
    workspace.contextMenu === null
      ? []
      : contextMenuFor(workspace.contextMenu.target, {
          graph: state.model?.graph ?? null,
          relationshipKinds: state.model?.vocabulary.relationshipKinds ?? [],
          activeViewId: state.activeView,
          filtered: state.activeFilter !== null,
          membership: activeViewMembership(state),
        });

  /**
   * Every menu item ends here. The menu itself decides nothing about what an
   * item does; it names an intent, and this is the single place that turns one
   * into the dispatch, filter or staged operation it already had a name for.
   */
  const runIntent = (intent: ContextMenuIntent) => {
    const graph = state.model?.graph ?? null;
    switch (intent.type) {
      case "subject.inspect": {
        const node = graph?.nodes.find(
          (candidate) => candidate.id === intent.id,
        );
        if (node === undefined) return;
        dispatchWorkspace({
          type: "subject.selected",
          subject: normalizeSelectedElement(node),
        });
        return;
      }
      case "relationship.inspect": {
        const edge = graph?.edges.find(
          (candidate) => candidate.id === intent.id,
        );
        if (edge === undefined || graph === null) return;
        dispatchWorkspace({
          type: "subject.selected",
          subject: normalizeSelectedRelationship(
            edge,
            new Map(graph.nodes.map((node) => [node.id, node.name] as const)),
          ),
        });
        return;
      }
      case "subject.connect":
        dispatchWorkspace({ type: "connection.started", from: intent.from });
        return;
      case "subject.delete":
      case "relationship.delete":
        // Both go through the same confirmation the side panel already uses:
        // `draftDeletion` composes the batch and knows an edge from a node.
        dispatchWorkspace({ type: "deletion.asked", id: intent.id });
        return;
      case "relationship.retype": {
        const edge = graph?.edges.find(
          (candidate) => candidate.id === intent.id,
        );
        if (edge === undefined) return;
        for (const operation of stageRelationshipScalarChange(
          edge.document,
          edge.localId,
          "kind",
          edge.kindLabel,
          intent.kind,
        )) {
          stageChange(operation);
        }
        dispatchWorkspace({ type: "menu.dismissed" });
        return;
      }
      case "canvas.draft-subject":
        dispatchWorkspace({ type: "subject.draft.opened" });
        return;
      case "view.add-subject":
      case "view.remove-subject":
        // Always the ACTIVE view: the menu only offers these where that view
        // has a membership list, and `activeViewMembership` is what decided
        // which of the two it offered.
        stageViewMembership(
          state.activeView,
          intent.id,
          intent.type === "view.add-subject" ? "add" : "remove",
        );
        dispatchWorkspace({ type: "menu.dismissed" });
        return;
      case "view.open":
        navigate(intent.id);
        dispatchWorkspace({ type: "menu.dismissed" });
        return;
      case "view.clear":
        clearFilter();
        dispatchWorkspace({ type: "menu.dismissed" });
        return;
      case "view.new":
        // Same two motions the rail's own new-view button makes: a new view
        // starts from the whole model, and the form seeds itself from what is
        // active, so clearing first is what makes its fields blank.
        clearFilter();
        setSaveViewDirectory(undefined);
        setSaveViewOpen(true);
        dispatchWorkspace({ type: "menu.dismissed" });
        return;
      case "view.delete":
        // Asked, not done: removing a projection is the one view operation
        // that destroys authored text, so it goes through the same
        // confirm-then-stage shape a subject deletion does.
        dispatchWorkspace({ type: "viewDeletion.asked", id: intent.id });
        return;
      case "view.rename":
        dispatchWorkspace({ type: "viewRename.asked", id: intent.id });
        return;
      case "view.duplicate": {
        const view = state.views.find((candidate) => candidate.id === intent.id);
        if (view === undefined) return;
        const copy = duplicateView(
          view,
          new Set(state.views.map((candidate) => candidate.id)),
        );
        stageViewChange({ op: "write-view", ...copy });
        dispatchWorkspace({ type: "menu.dismissed" });
        return;
      }
      case "view.new-in-folder": {
        const view = state.views.find((candidate) => candidate.id === intent.id);
        if (view === undefined) return;
        // The form writes into this folder rather than the default one. A
        // folder that already holds a projection is one the manifest reaches,
        // which is why the only way to name a folder is to point at a view in
        // it.
        setSaveViewDirectory(directoryOf(view.path));
        clearFilter();
        setSaveViewOpen(true);
        dispatchWorkspace({ type: "menu.dismissed" });
        return;
      }
      case "view.copy-path": {
        const view = state.views.find((candidate) => candidate.id === intent.id);
        if (view === undefined) return;
        void navigator.clipboard?.writeText(view.path);
        dispatchWorkspace({ type: "menu.dismissed" });
        return;
      }
      case "canvas.export-png": {
        const png = canvasPngRef.current;
        if (png === null) return;
        // A local page, so an anchor with a data: href is the whole download.
        const link = document.createElement("a");
        link.href = png();
        link.download = `${state.activeView === "" ? "all-subjects" : state.activeView}.png`;
        link.click();
        dispatchWorkspace({ type: "menu.dismissed" });
        return;
      }
    }
  };

  const pendingViewDelete =
    workspace.pendingViewDeletion === null
      ? null
      : (state.views.find(
          (view) => view.id === workspace.pendingViewDeletion,
        ) ?? null);

  const pendingViewRename =
    workspace.pendingViewRename === null
      ? null
      : (state.views.find((view) => view.id === workspace.pendingViewRename) ??
        null);

  return (
    <main className="visual-shell" style={shellStyle}>
      <CommandStrip
        state={state}
        connection={connectionOf(state, connected)}
        detailsOpen={workspace.detailsOpen}
        conversationOpen={conversationOpen}
        unread={workspace.conversation.unread}
        layout={workspace.layout}
        showLifecycle={workspace.showLifecycle}
        showEvidence={workspace.showEvidence}
        showOwnership={workspace.showOwnership}
        views={state.views}
        onToggleDetails={() => dispatchWorkspace({ type: "details.toggled" })}
        onToggleConversation={() =>
          dispatchWorkspace({ type: "conversation.toggled" })
        }
        onSelectLayout={(layout) =>
          dispatchWorkspace({ type: "layout.set", layout })
        }
        onTogglePresentation={(flag, value) =>
          dispatchWorkspace({ type: "presentation.toggled", flag, value })
        }
        onApplyFilter={filter}
        quickFilterText={state.quickFilterText}
        onQuickFilterChange={setQuickFilterText}
        saveViewOpen={saveViewOpen}
        saveViewDirectory={saveViewDirectory}
        onToggleSaveView={() => setSaveViewOpen((open) => !open)}
        onStageView={stageViewChange}
        onEnd={end}
      />
      <div
        className={`workspace workspace-conversation-${
          conversationOpen ? "open" : "closed"
        }`}
      >
        <ViewTree
          views={state.views}
          activeViewId={state.activeView}
          nodes={state.model?.graph.nodes ?? []}
          // What the canvas is drawing, which is the graph narrowed by the
          // standing filter's match set — never `state.model.graph`, which
          // holds every subject the workspace declares whatever is on screen.
          inViewIds={
            state.activeFilter === null
              ? null
              : new Set(state.activeFilter.matchedIds)
          }
          filterText={workspace.tree.filterText}
          collapsed={treeCollapsed}
          onFilterChange={(filterText) =>
            dispatchWorkspace({ type: "tree.filtered", filterText })
          }
          onToggle={(key) => dispatchWorkspace({ type: "tree.toggled", key })}
          onSelectView={(id) => navigate(id)}
          onClearView={clearFilter}
          onNewView={() => {
            // A new view starts from the whole model rather than from whatever
            // the last one narrowed to, and the form seeds itself from the
            // active view — so clearing first is what makes its fields blank.
            clearFilter();
            setSaveViewDirectory(undefined);
            setSaveViewOpen(true);
          }}
          onSelectSubject={(id) => {
            const node = state.model?.graph.nodes.find(
              (candidate) => candidate.id === id,
            );
            if (node === undefined) return;
            dispatchWorkspace({
              type: "subject.selected",
              subject: normalizeSelectedElement(node),
            });
          }}
          onRowMenu={(row, position) =>
            openMenu(
              row.kind === "view"
                ? { kind: "view-row", id: row.id }
                : { kind: "model-row", id: row.id },
              position,
            )
          }
        />
        <DiagramWorkspace
          state={state}
          selectedId={workspace.selectedSubject?.id ?? null}
          waiting={waiting}
          layout={workspace.layout}
          nesting={workspace.nesting}
          connection={workspace.connection}
          onConnectTarget={(id) =>
            dispatchWorkspace({ type: "connection.targeted", to: id })
          }
          onConnectCancel={() =>
            dispatchWorkspace({ type: "connection.cancelled" })
          }
          onConnectStage={stageChange}
          onDraftStage={(operation) => {
            stageChange(operation);
            // A view that LISTS its subjects cannot match one that did not
            // exist when the list was written, so it has to be told. A view
            // that describes them with facets already knows, and the reducer
            // is what decides which this is - the shell states the intent and
            // holds no copy of the rule.
            if (operation.op === "add-concept") {
              stageViewMembership(
                state.activeView,
                operation.concept.id,
                "add",
              );
            }
          }}
          draftingSubject={workspace.draftingSubject}
          onDraftSubject={() =>
            dispatchWorkspace({ type: "subject.draft.opened" })
          }
          onDraftSubjectClose={() =>
            dispatchWorkspace({ type: "subject.draft.closed" })
          }
          pendingDeletion={workspace.pendingDeletion}
          onDeletionDismiss={() =>
            dispatchWorkspace({ type: "deletion.dismissed" })
          }
          showLifecycle={workspace.showLifecycle}
          showEvidence={workspace.showEvidence}
          showOwnership={workspace.showOwnership}
          onSelect={(subject) =>
            dispatchWorkspace({ type: "subject.selected", subject })
          }
          onCanvasMenu={(target, position) =>
            openMenu(
              target.type === "node"
                ? { kind: "subject", id: target.id ?? "" }
                : target.type === "edge"
                  ? { kind: "relationship", id: target.id ?? "" }
                  : { kind: "canvas" },
              position,
            )
          }
          onClearFilter={clearFilter}
          onSaveLayout={saveLayout}
          onCanvasReady={(png) => {
            canvasPngRef.current = png;
          }}
        />
        {conversationOpen ? (
          <ConversationSeparator
            width={workspace.conversation.width}
            viewportWidth={workspace.viewportWidth}
            onResize={(width) =>
              dispatchWorkspace({ type: "conversation.resized", width })
            }
          />
        ) : null}
        <ConversationPanel
          state={state}
          hidden={!conversationOpen}
          disabled={!state.composerEnabled}
          selectedSubject={workspace.selectedSubject}
          descriptionExpanded={workspace.descriptionExpanded}
          onSend={(text) =>
            ask(formatContextualQuestion(text, workspace.selectedSubject))
          }
          onChoice={choose}
          onToggleDescription={() =>
            dispatchWorkspace({ type: "description.toggled" })
          }
          onClearSubject={() => dispatchWorkspace({ type: "subject.cleared" })}
          onConnect={(from) =>
            dispatchWorkspace({ type: "connection.started", from })
          }
          onDelete={(id) => dispatchWorkspace({ type: "deletion.asked", id })}
          onDiscardChange={discardChange}
          onStageChange={stageChange}
          onClearChangeset={clearChangeset}
          onUndoChangeset={undoChangeset}
          onRedoChangeset={redoChangeset}
          onCommitChangeset={commitChangeset}
        />
      </div>
      {/* At the shell, not inside the canvas or the rail: a menu opened on the
          last row of the rail has to be able to hang past the rail's edge. */}
      {workspace.contextMenu === null ? null : (
        <ContextMenu
          groups={menuGroups}
          x={workspace.contextMenu.x}
          y={workspace.contextMenu.y}
          onChoose={runIntent}
          onDismiss={() => dispatchWorkspace({ type: "menu.dismissed" })}
        />
      )}
      {pendingViewRename === null ? null : (
        <PromptDialog
          title="Rename view"
          label="Title"
          initialValue={pendingViewRename.title}
          confirmLabel="Rename"
          cancelLabel="Cancel"
          onConfirm={(title) => {
            stageViewChange({
              op: "write-view",
              ...renameView(pendingViewRename, title),
            });
            dispatchWorkspace({ type: "viewRename.dismissed" });
          }}
          onCancel={() => dispatchWorkspace({ type: "viewRename.dismissed" })}
        />
      )}
      {pendingViewDelete === null ? null : (
        <ConfirmDialog
          title="Delete view"
          message={`Stage the removal of "${pendingViewDelete.title}"? The projection document goes when the changeset is committed; no subject is touched.`}
          confirmLabel="Delete"
          cancelLabel="Keep"
          onConfirm={() => {
            stageViewChange({
              op: "delete-view",
              path: pendingViewDelete.path,
            });
            dispatchWorkspace({ type: "viewDeletion.dismissed" });
          }}
          onCancel={() => dispatchWorkspace({ type: "viewDeletion.dismissed" })}
        />
      )}
    </main>
  );
};
