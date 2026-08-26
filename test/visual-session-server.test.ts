import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { watch as watchEagerly } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { parse } from "yaml";
import {
  VISUAL_LIMITS,
  fromWireFileUri,
  parseVisualDiagnosticResult,
  parseVisualSessionDescriptor,
  type VisualDiagnostic,
  type VisualEvent,
  type VisualModel,
  type VisualResponse,
  type VisualSessionRequest,
} from "../src/adapters/visual/protocol.js";
import {
  VISUAL_BROWSER_HEADERS,
  VISUAL_SERVER_LIMITS,
  visualContentSecurityPolicy,
  startVisualServer,
  type VisualServerFrame,
  type VisualServerHandle,
  type VisualServerOptions,
} from "../src/adapters/visual/session-server.js";
import type {
  VisualChatAppliedQuery,
  VisualViewSummary,
} from "../src/adapters/visual/protocol-contract.js";
import { compileWorkspaceWithProfileContext } from "../src/compiler.js";
import { projectGraphForCanvas } from "../src/graph-projection.js";

const fixtures = fileURLToPath(new URL("./fixtures/visual/", import.meta.url));
const assetRoot = join(fixtures, "browser-assets");

const modelWith = (): VisualModel => {
  const compiled = compileWorkspaceWithProfileContext([
    {
      path: "main.yaml",
      source: `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: system
    kind: applicationComponent
    name: System
relationships: []
`,
    },
  ]);
  if (!compiled.ok) {
    throw new Error(
      `Failed to compile fixture workspace: ${compiled.diagnostics[0]?.message}`,
    );
  }
  return {
    format: "yarramate/visual-model/v1",
    authority: "canonical",
    initialView: "default",
    sourceDigests: { "model.likec4": "a".repeat(64) },
    graph: projectGraphForCanvas(compiled.graph, compiled.profileContext),
  };
};

const request: VisualSessionRequest = {
  format: "yarramate/visual-session-request/v1",
  authority: "canonical",
  title: "Choose a delivery design",
  description: "Design options drawn from the checked workspace",
  chatEnabled: true,
  initialModel: modelWith(),
};

const chatEventInput = {
  type: "chat.message",
  lastAcknowledgedSequence: 0,
  payload: { text: "Compare the two delivery designs" },
} as const;

const identifier = (index: number) => index.toString(16).padStart(32, "0");

let baseDir = "";
const running: VisualServerHandle[] = [];

const start = async (overrides: Partial<VisualServerOptions> = {}) => {
  const handle = await startVisualServer({
    request,
    baseDir,
    cwd: baseDir,
    assetRoot,
    // Long enough that an event racing a poll always wins; the idle tests set
    // their own ceiling.
    agentPollMs: 4000,
    ...overrides,
  });
  running.push(handle);
  return handle;
};

/**
 * The wire publishes `file:` URIs, so a test that goes on to touch the
 * filesystem decodes one exactly the way a client does — which also asserts
 * that what the runtime published is decodable at all.
 */
const nativePath = (uri: string): string => {
  const decoded = fromWireFileUri(uri);
  if (!decoded.ok) {
    throw new Error(`"${uri}" is not a canonical wire path: ${decoded.reason}`);
  }
  return decoded.value;
};

/**
 * Reads the private descriptor through the protocol parser, so a test that
 * depends on one of its fields also asserts the document is valid.
 */
const readDescriptor = async (descriptorUri: string) => {
  const parsed = parseVisualSessionDescriptor(
    JSON.parse(await readFile(nativePath(descriptorUri), "utf8")),
  );
  if (!parsed.ok) {
    throw new Error(
      `descriptor "${descriptorUri}" is invalid: ${parsed.diagnostics[0]?.message}`,
    );
  }
  return parsed.value;
};

/** The agent capability lives only in the mode 0600 descriptor. */
const capabilityOf = async (handle: VisualServerHandle) =>
  (await readDescriptor(handle.started.descriptorPath)).agentCapability;

const bootstrap = async (handle: VisualServerHandle) => {
  const response = await fetch(handle.started.browserUrl, {
    redirect: "manual",
  });
  const header = response.headers.get("set-cookie");
  if (header === null) throw new Error("bootstrap returned no cookie");
  return { response, cookie: header.split(";")[0] as string };
};

/**
 * Every frame the socket has received and no assertion has claimed yet. The
 * server sends `ready` the moment it accepts the upgrade, which can land before
 * the test gets a chance to listen, so frames are buffered from construction.
 */
const buffered = new WeakMap<WebSocket, VisualServerFrame[]>();

const openBrowserSocket = async (
  handle: VisualServerHandle,
  cookie: string,
) => {
  const socket = new WebSocket(handle.started.webSocketUrl, {
    headers: { Cookie: cookie, Origin: handle.started.origin },
  });
  const frames: VisualServerFrame[] = [];
  buffered.set(socket, frames);
  socket.on("message", (data) => {
    frames.push(JSON.parse(String(data)) as VisualServerFrame);
  });
  await once(socket, "open");
  return socket;
};

const nextFrame = async <Kind extends VisualServerFrame["kind"]>(
  socket: WebSocket,
  kind: Kind,
  match: (frame: Extract<VisualServerFrame, { kind: Kind }>) => boolean = () =>
    true,
): Promise<Extract<VisualServerFrame, { kind: Kind }>> => {
  const frames = buffered.get(socket) ?? [];
  const take = () => {
    const index = frames.findIndex(
      (frame) =>
        frame.kind === kind &&
        match(frame as Extract<VisualServerFrame, { kind: Kind }>),
    );
    return index < 0
      ? undefined
      : (frames.splice(index, 1)[0] as Extract<
          VisualServerFrame,
          { kind: Kind }
        >);
  };
  for (;;) {
    const found = take();
    if (found !== undefined) return found;
    await once(socket, "message");
  }
};

const sendChat = (socket: WebSocket, text: string) => {
  const accepted = nextFrame(socket, "accepted");
  socket.send(
    JSON.stringify({
      type: "chat.message",
      lastAcknowledgedSequence: 0,
      payload: { text },
    }),
  );
  return accepted;
};

const agentFetch = (
  handle: VisualServerHandle,
  capability: string,
  path: string,
  init: RequestInit = {},
) =>
  fetch(`${handle.started.origin}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${capability}`,
      ...(init.headers ?? {}),
    },
  });

const postResponse = (
  handle: VisualServerHandle,
  capability: string,
  response: VisualResponse,
) =>
  agentFetch(handle, capability, "/api/agent/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(response),
  });

/**
 * The success path of `postResponse`. A refusal is never what a test that goes
 * on to read session state meant to exercise, so a vacuous POST is caught here
 * rather than surviving as a silently skipped transition.
 */
const postAcceptedResponse = async (
  handle: VisualServerHandle,
  capability: string,
  response: VisualResponse,
) => {
  const posted = await postResponse(handle, capability, response);
  expect(posted.status).toBe(200);
  const body = (await posted.json()) as { readonly accepted: boolean };
  expect(body.accepted).toBe(true);
  return body;
};

/** The question this session is still holding, as a reloading browser reads it. */
const pendingChoiceOf = async (handle: VisualServerHandle, cookie: string) => {
  const session = (await (
    await fetch(`${handle.started.origin}/api/session`, {
      headers: { Cookie: cookie },
    })
  ).json()) as { readonly pendingChoice: unknown };
  return session.pendingChoice;
};

const deliveryQuestion = {
  choiceId: "delivery",
  question: "Which delivery design should we keep?",
  options: [
    { id: "shared-queue", label: "Shared queue" },
    { id: "isolated-worker", label: "Isolated worker" },
  ],
} as const;

const choicePresent = (
  handle: VisualServerHandle,
  eventId: string,
  index: number,
): VisualResponse => ({
  format: "yarramate/visual-response/v1",
  sessionId: handle.started.sessionId,
  responseId: identifier(index),
  eventId,
  type: "choice.present",
  timestamp: "2026-08-08T00:00:02.000Z",
  payload: deliveryQuestion,
});

const chatResponse = (
  handle: VisualServerHandle,
  eventId: string,
  index: number,
  text = "Design A isolates delivery; design B shares it.",
): VisualResponse => ({
  format: "yarramate/visual-response/v1",
  sessionId: handle.started.sessionId,
  responseId: identifier(index),
  eventId,
  type: "chat.response",
  timestamp: "2026-08-08T00:00:02.000Z",
  payload: { text },
});

/**
 * Waits for the next event the journal named by a session descriptor carries
 * past `after`, and answers only if it is the `type` the caller is correlating
 * against. The descriptor is the agent's only entry point into the session, so
 * the helper reads the journal the way an out-of-process agent would, and it
 * waits on the file's own change events rather than on a guessed delay.
 *
 * Naming the type is what makes the wait a correlation rather than a cursor:
 * the runtime journals records of its own, and a wait that took whatever came
 * next would hand one of those back as the event under test.
 */
const waitForVisualEvent = async <Type extends VisualEvent["type"]>(
  descriptorUri: string,
  after: number,
  type: Type,
): Promise<Extract<VisualEvent, { readonly type: Type }>> => {
  const journalPath = nativePath(
    (await readDescriptor(descriptorUri)).journalPath,
  );
  // The callback watcher, not `fs/promises.watch`: the promise form is an async
  // generator that registers nothing until its first iteration, so it cannot be
  // armed ahead of the read the way this window needs. This one is watching
  // from the moment it is constructed, and every change it sees is counted, so
  // an append landing during the read below is observed rather than lost.
  let changes = 0;
  let changed = Promise.withResolvers<void>();
  const watcher = watchEagerly(journalPath, () => {
    changes += 1;
    changed.resolve();
    changed = Promise.withResolvers<void>();
  });
  try {
    for (;;) {
      const seen = changes;
      const lines = (await readFile(journalPath, "utf8"))
        .split("\n")
        .filter((line) => line.length > 0);
      for (const line of lines) {
        const record = JSON.parse(line) as VisualEvent | VisualResponse;
        if (record.format !== "yarramate/visual-event/v1") continue;
        if (record.sequence <= after) continue;
        if (record.type !== type) {
          throw new Error(
            `journal holds ${record.type} at sequence ${record.sequence}, not the ${type} this wait is for`,
          );
        }
        return record as Extract<VisualEvent, { readonly type: Type }>;
      }
      // Nothing since the read began, so there is a change worth waiting for.
      if (changes === seen) await changed.promise;
    }
  } finally {
    watcher.close();
  }
};

const journalOf = async (handle: VisualServerHandle) =>
  (await readFile(join(nativePath(handle.started.sessionRoot), "journal.jsonl"), "utf8"))
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as VisualEvent | VisualResponse);

/** One event-loop turn, so an observed in-process condition can be re-read. */
const tick = async () => {
  const turn = Promise.withResolvers<void>();
  setImmediate(turn.resolve);
  await turn.promise;
};

/**
 * Resolves once the session has admitted an agent request. Authenticating the
 * capability and registering the long poll are one synchronous step, so an
 * attached agent is exactly a poll the server is already holding: an observed
 * condition in this process rather than a guessed delay, and nothing the
 * runtime carries for the test.
 */
const waitForAttachedAgent = async (handle: VisualServerHandle) => {
  while (!handle.status().agent.attached) await tick();
};

/**
 * Resolves once the session has journaled up to `sequence`. The runtime moves
 * its own queue cursor one statement *after* the append resolves, so a wait on
 * the journal file can see a record the server has not finished accounting
 * for. This is the stronger of the two waits — it implies the file too — and it
 * is what anything that then reads server state has to wait on.
 */
const waitForSequence = async (
  handle: VisualServerHandle,
  sequence: number,
) => {
  while (handle.status().queue.lastSequence < sequence) await tick();
};

/**
 * Rejections raised by fire-and-forget socket work never reach a test's
 * `await`, so they are collected from the process the way Node would see
 * them: an empty list is the assertion that nothing crashed the runtime.
 */
const collectRejections = () => {
  const seen: unknown[] = [];
  const observe = (reason: unknown) => seen.push(reason);
  process.on("unhandledRejection", observe);
  return {
    seen,
    settled: async () => {
      // A rejection is reported a macrotask after it is raised, so give the
      // loop two turns before deciding nothing was left unobserved.
      await tick();
      await tick();
      process.off("unhandledRejection", observe);
      return seen;
    },
  };
};

/** Raw request/response text, so Host and unnormalised paths stay verbatim. */
const rawRequest = (origin: string, lines: readonly string[]) =>
  new Promise<string>((resolve, reject) => {
    const port = Number(new URL(origin).port);
    const socket = connect(port, "127.0.0.1", () => {
      socket.write([...lines, "", ""].join("\r\n"));
    });
    let text = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      text += chunk;
    });
    socket.on("end", () => resolve(text));
    socket.on("error", reject);
  });

/**
 * Every session start resolves `<cwd>/.yarramate/workspace.yaml` and refuses
 * to start (YMVS132) without one, so each test gets an empty-but-valid
 * manifest by default; tests that need real documents overwrite this file.
 */
const minimalWorkspaceManifest = `format: yarramate/workspace/v1
id: empty-fixture
documents: []
profiles: []
projections: []
adapterMappings: []
evidence: []
contracts: []
`;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), "yarramate-visual-server-"));
  await mkdir(join(baseDir, ".yarramate"), { recursive: true });
  await writeFile(
    join(baseDir, ".yarramate/workspace.yaml"),
    minimalWorkspaceManifest,
    "utf8",
  );
});

afterEach(async () => {
  for (const handle of running.splice(0)) {
    await handle.stop("main-cancelled");
  }
  await rm(baseDir, { recursive: true, force: true });
});

describe("startVisualServer bootstrap and browser authentication", () => {
  it("exchanges the bootstrap token and accepts an authenticated browser socket", async () => {
    const server = await start();
    const response = await fetch(server.started.browserUrl, {
      redirect: "manual",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).toMatch(
      /^ym_visual=[^;]+; HttpOnly; SameSite=Strict; Secure; Path=\/$/,
    );

    const socket = await openBrowserSocket(
      server,
      (response.headers.get("set-cookie") as string).split(";")[0] as string,
    );
    socket.send(JSON.stringify(chatEventInput));
    await expect(
      // Sequence 1 is the connection the runtime journaled for this socket.
      waitForVisualEvent(server.started.descriptorPath, 1, "chat.message"),
    ).resolves.toMatchObject({ sequence: 2 });
    socket.close();
  });

  it("never returns the bootstrap token in the cookie it mints", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const token = new URL(server.started.browserUrl).searchParams.get("key");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(cookie).not.toContain(token as string);
  });

  it("stores only a derived browser authenticator in the cookie", async () => {
    const generatedSecrets: string[] = [];
    let draw = 0;
    const server = await start({
      randomBytes: (size) => {
        draw += 1;
        const secret = Buffer.alloc(size, draw);
        generatedSecrets.push(secret.toString("hex"));
        return secret;
      },
    });
    const { cookie } = await bootstrap(server);
    const value = cookie.slice("ym_visual=".length);
    expect(generatedSecrets).not.toContain(value);
  });

  it("refuses a replayed bootstrap token", async () => {
    const server = await start();
    await bootstrap(server);
    const replay = await fetch(server.started.browserUrl, {
      redirect: "manual",
    });
    expect(replay.status).toBe(403);
    expect(replay.headers.get("set-cookie")).toBeNull();
  });

  it("refuses a bootstrap key that is not the browser capability", async () => {
    const server = await start();
    const forged = new URL(server.started.browserUrl);
    forged.searchParams.set("key", "a".repeat(64));
    const response = await fetch(forged, { redirect: "manual" });
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("serves the browser application only to a cookie-bearing request", async () => {
    const server = await start();
    const anonymous = await fetch(`${server.started.origin}/`);
    expect(anonymous.status).toBe(401);

    const { cookie } = await bootstrap(server);
    const page = await fetch(`${server.started.origin}/`, {
      headers: { Cookie: cookie },
    });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    await expect(page.text()).resolves.toContain("/assets/app-1a2b3c4d.js");
  });

  it("returns the exact browser security headers on every browser response", async () => {
    const server = await start();
    const { response, cookie } = await bootstrap(server);
    const page = await fetch(`${server.started.origin}/`, {
      headers: { Cookie: cookie },
    });
    const asset = await fetch(
      `${server.started.origin}/assets/app-1a2b3c4d.js`,
      { headers: { Cookie: cookie } },
    );
    const denied = await fetch(`${server.started.origin}/`);
    for (const checked of [response, page, asset, denied]) {
      for (const [name, value] of Object.entries(VISUAL_BROWSER_HEADERS)) {
        expect(checked.headers.get(name)).toBe(value);
      }
    }
  });

  it("admits inline style only under this session own nonce", async () => {
    const server = await start();
    const { response, cookie } = await bootstrap(server);
    const page = await fetch(`${server.started.origin}/`, {
      headers: { Cookie: cookie },
    });
    const snapshot = (await (
      await fetch(`${server.started.origin}/api/session`, {
        headers: { Cookie: cookie },
      })
    ).json()) as { readonly styleNonce: string };

    expect(snapshot.styleNonce).toMatch(/^[0-9a-f]{32}$/);
    for (const checked of [response, page]) {
      const policy = checked.headers.get("content-security-policy") as string;
      expect(policy).toBe(visualContentSecurityPolicy(snapshot.styleNonce));
      expect(policy).toContain(
        `style-src 'self' 'nonce-${snapshot.styleNonce}'`,
      );
      // A nonce admits the styles this application ships and nothing else.
      expect(policy).not.toContain("unsafe-inline");
      expect(policy).toContain(`script-src 'self'`);
      expect(policy).toContain(`frame-ancestors 'none'`);
    }
  });

  it("mints a nonce no other session can use", async () => {
    const first = await start();
    const second = await start();
    const nonceOf = async (server: VisualServerHandle) => {
      const { cookie } = await bootstrap(server);
      const snapshot = (await (
        await fetch(`${server.started.origin}/api/session`, {
          headers: { Cookie: cookie },
        })
      ).json()) as { readonly styleNonce: string };
      return snapshot.styleNonce;
    };
    expect(await nonceOf(first)).not.toBe(await nonceOf(second));
  });

  it("restores the conversation to a browser that reloads", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const asked = await sendChat(socket, "Why is option B cheaper?");
    await postResponse(
      server,
      capability,
      chatResponse(server, asked.eventId, 3, "It reuses the intake path."),
    );
    socket.close();
    // The reload is read after the runtime has accounted for the socket it
    // replaces, so the sequence the snapshot reports is settled, not raced.
    await waitForSequence(server, 3);

    const session = (await (
      await fetch(`${server.started.origin}/api/session`, {
        headers: { Cookie: cookie },
      })
    ).json()) as {
      readonly transcript: readonly { readonly text: string }[];
      readonly lastSequence: number;
    };

    expect(session.transcript).toEqual([
      {
        id: asked.eventId,
        speaker: "reviewer",
        text: "Why is option B cheaper?",
      },
      {
        id: identifier(3),
        speaker: "agent",
        text: "It reuses the intake path.",
      },
    ]);
    expect(session.lastSequence).toBe(3);
  });

  it("tells a reconnecting browser whether the agent still owes an answer", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const snapshotNow = async () => {
      const body = (await (
        await fetch(`${server.started.origin}/api/session`, {
          headers: { Cookie: cookie },
        })
      ).json()) as { readonly agentTurnOpen: boolean };
      return body.agentTurnOpen;
    };

    expect(await snapshotNow()).toBe(false);
    const asked = await sendChat(socket, "Why is option B cheaper?");
    expect(await snapshotNow()).toBe(true);

    await postResponse(
      server,
      capability,
      chatResponse(server, asked.eventId, 5, "It reuses the intake path."),
    );
    // The turn the browser opened is closed, whether or not it was connected to
    // see the answer land.
    expect(await snapshotNow()).toBe(false);
    socket.close();
  });

  it("restores a selected choice by the label the reviewer read", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const asked = await sendChat(socket, "Which option?");
    await postResponse(server, capability, {
      format: "yarramate/visual-response/v1",
      sessionId: server.started.sessionId,
      responseId: identifier(4),
      eventId: asked.eventId,
      type: "choice.present",
      timestamp: "2026-08-08T00:00:02.000Z",
      payload: {
        choiceId: "delivery",
        question: "Which delivery design should we keep?",
        options: [
          { id: "shared-queue", label: "Shared queue" },
          { id: "isolated-worker", label: "Isolated worker" },
        ],
      },
    });
    const chosen = nextFrame(socket, "accepted");
    socket.send(
      JSON.stringify({
        type: "choice.selected",
        lastAcknowledgedSequence: 1,
        payload: { choiceId: "delivery", optionId: "shared-queue" },
      }),
    );
    await chosen;
    socket.close();

    const session = (await (
      await fetch(`${server.started.origin}/api/session`, {
        headers: { Cookie: cookie },
      })
    ).json()) as {
      readonly transcript: readonly { readonly text: string }[];
    };
    // The record says what the reviewer chose, not the identifier they clicked.
    expect(session.transcript.at(-1)).toMatchObject({
      speaker: "reviewer",
      text: "Shared queue",
    });
  });

  it("restores a choice the agent is still waiting on", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const asked = await sendChat(socket, "Which option?");

    expect(await pendingChoiceOf(server, cookie)).toBe(null);
    await postAcceptedResponse(
      server,
      capability,
      choicePresent(server, asked.eventId, 4),
    );
    // The question lives in the agent's response, never in the transcript, so
    // a browser that reloads reads it here or cannot answer at all.
    expect(await pendingChoiceOf(server, cookie)).toEqual(deliveryQuestion);

    const chosen = nextFrame(socket, "accepted");
    socket.send(
      JSON.stringify({
        type: "choice.selected",
        lastAcknowledgedSequence: 1,
        payload: { choiceId: "delivery", optionId: "shared-queue" },
      }),
    );
    await chosen;
    expect(await pendingChoiceOf(server, cookie)).toBe(null);
    socket.close();
  });

  it("drops a waiting choice the reviewer asked past", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const asked = await sendChat(socket, "Which option?");
    await postAcceptedResponse(
      server,
      capability,
      choicePresent(server, asked.eventId, 4),
    );
    expect(await pendingChoiceOf(server, cookie)).toEqual(deliveryQuestion);

    // Asking something else is how a reviewer declines to choose, and the
    // browser closes the buttons on itself when it sends one.
    await sendChat(socket, "What does the queue cost?");

    expect(await pendingChoiceOf(server, cookie)).toBe(null);
    socket.close();
  });

  it("waits on nothing once the reviewer has ended the session", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const asked = await sendChat(socket, "Which option?");
    await postAcceptedResponse(
      server,
      capability,
      choicePresent(server, asked.eventId, 4),
    );
    expect(await pendingChoiceOf(server, cookie)).toEqual(deliveryQuestion);

    const ended = nextFrame(socket, "accepted");
    socket.send(
      JSON.stringify({
        type: "session.end",
        lastAcknowledgedSequence: 1,
        payload: { reason: "user-ended" },
      }),
    );
    await ended;

    // A session on its way out is waiting on nobody, so a browser that comes
    // back to it is not asked a question again.
    expect(await pendingChoiceOf(server, cookie)).toBe(null);
    socket.close();
  });

  it("holds no question the agent presented after the reviewer ended", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const asked = await sendChat(socket, "Which option?");

    const ended = nextFrame(socket, "accepted");
    socket.send(
      JSON.stringify({
        type: "session.end",
        lastAcknowledgedSequence: 1,
        payload: { reason: "user-ended" },
      }),
    );
    const end = await ended;

    // The agent was still composing when the End landed, so its question
    // answers an event whose reviewer has already walked away.
    await postAcceptedResponse(
      server,
      capability,
      choicePresent(server, asked.eventId, 4),
    );
    // The handoff a terminating session waits for is still the agent's to
    // send, so a response after an End stays admissible.
    await postAcceptedResponse(server, capability, {
      format: "yarramate/visual-response/v1",
      sessionId: server.started.sessionId,
      responseId: identifier(5),
      eventId: end.eventId,
      type: "handoff.complete",
      timestamp: "2026-08-08T00:00:05.000Z",
      payload: {
        summary: "The reviewer ended before choosing a delivery design.",
        confirmedDecisions: [],
        requestedChanges: [],
        unresolvedQuestions: ["Which delivery design should we keep?"],
        finalViews: ["choices"],
      },
    });

    // A browser that reloads into an ended session is never handed buttons it
    // can no longer press.
    expect(await pendingChoiceOf(server, cookie)).toBe(null);
    socket.close();
  });

  it("never puts model sources or credentials in a restored conversation", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    await sendChat(socket, "anything");
    socket.close();
    const body = await (
      await fetch(`${server.started.origin}/api/session`, {
        headers: { Cookie: cookie },
      })
    ).text();
    expect(body).not.toContain("model.likec4");
    expect(body).not.toContain(await capabilityOf(server));
    const secret = cookie.split("=")[1] ?? "";
    expect(secret.length).toBeGreaterThan(0);
    expect(body).not.toContain(secret);
  });

  it("rejects a request whose Host header is not the bound loopback authority", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const text = await rawRequest(server.started.origin, [
      "GET / HTTP/1.1",
      "Host: visual.attacker.example",
      `Cookie: ${cookie}`,
      "Connection: close",
    ]);
    expect(text.split("\r\n")[0]).toContain("403");
  });

  it("rejects a browser request from a foreign origin", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const response = await fetch(`${server.started.origin}/api/session`, {
      headers: { Cookie: cookie, Origin: "http://attacker.example" },
    });
    expect(response.status).toBe(403);
  });

  it("rejects a WebSocket upgrade without the session cookie", async () => {
    const server = await start();
    const socket = new WebSocket(server.started.webSocketUrl, {
      headers: { Origin: server.started.origin },
    });
    const [error] = (await once(socket, "error")) as [Error];
    expect(error.message).toContain("401");
  });

  it("rejects a WebSocket upgrade from a foreign origin", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = new WebSocket(server.started.webSocketUrl, {
      headers: { Cookie: cookie, Origin: "http://attacker.example" },
    });
    const [error] = (await once(socket, "error")) as [Error];
    expect(error.message).toContain("403");
  });

  it("reserves the browser connection limit before journaling admission", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const opened: WebSocket[] = [];
    const attempts = Array.from(
      { length: VISUAL_SERVER_LIMITS.browserConnections + 4 },
      () =>
        new Promise<number>((resolve, reject) => {
          const socket = new WebSocket(server.started.webSocketUrl, {
            headers: { Cookie: cookie, Origin: server.started.origin },
          });
          socket.once("open", () => {
            opened.push(socket);
            resolve(101);
          });
          socket.once("unexpected-response", (_request, response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          });
          socket.once("error", reject);
        }),
    );

    const outcomes = await Promise.all(attempts);
    for (const socket of opened) socket.close();

    expect(outcomes.filter((status) => status === 101)).toHaveLength(
      VISUAL_SERVER_LIMITS.browserConnections,
    );
    expect(outcomes.filter((status) => status !== 101)).toEqual(
      Array(4).fill(503),
    );
  });

  it("rejects a cookie minted by another session", async () => {
    const first = await start();
    const second = await start();
    const { cookie } = await bootstrap(first);
    const response = await fetch(`${second.started.origin}/api/session`, {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(401);
  });

  it("reports the rendered session to an authenticated browser", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const response = await fetch(`${server.started.origin}/api/session`, {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sessionId: server.started.sessionId,
      title: "Choose a delivery design",
      chatEnabled: true,
      lastSequence: 0,
      frozen: false,
      model: {
        authority: "canonical",
        initialView: "default",
        graph: { nodes: expect.any(Array), edges: expect.any(Array) },
      },
    });
  });
});

describe("startVisualServer agent capability separation", () => {
  it("rejects an agent route without a bearer capability", async () => {
    const server = await start();
    const response = await fetch(`${server.started.origin}/api/agent/status`);
    expect(response.status).toBe(401);
  });

  it("rejects the browser capability presented as an agent bearer token", async () => {
    const server = await start();
    const token = new URL(server.started.browserUrl).searchParams.get(
      "key",
    ) as string;
    const response = await agentFetch(server, token, "/api/agent/status");
    expect(response.status).toBe(401);
  });

  it("rejects a browser cookie presented to an agent route", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const response = await fetch(`${server.started.origin}/api/agent/status`, {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(401);
  });

  it("rejects an agent request that carries a browser origin", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const response = await agentFetch(server, capability, "/api/agent/status", {
      headers: { Origin: server.started.origin },
    });
    expect(response.status).toBe(403);
  });

  it("rejects an agent capability minted by another session", async () => {
    const first = await start();
    const second = await start();
    const capability = await capabilityOf(first);
    const response = await agentFetch(second, capability, "/api/agent/status");
    expect(response.status).toBe(401);
  });

  it("reports session status to the agent", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const response = await agentFetch(server, capability, "/api/agent/status");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      format: "yarramate/visual-status/v1",
      sessionId: server.started.sessionId,
      lifecycle: "running",
      alreadyStopped: false,
      server: { listening: true, origin: server.started.origin },
      agent: { attached: true, inFlightEventId: null },
      queue: { pendingEvents: 0, lastSequence: 0, frozen: false },
    });
  });
});

describe("startVisualServer event queue and long polling", () => {
  it("answers an idle long poll with a non-terminal waiting result", async () => {
    const server = await start({ agentPollMs: 60 });
    const capability = await capabilityOf(server);
    const response = await agentFetch(
      server,
      capability,
      "/api/agent/events?after=0",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      waiting: true,
      lastSequence: 0,
      pendingEvents: 0,
    });
    expect(server.status().lifecycle).toBe("running");
  });

  it("releases a waiting long poll with the event the browser just sent", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);

    const polled = agentFetch(server, capability, "/api/agent/events?after=0");
    await sendChat(socket, "Compare the two delivery designs");
    const body = (await (await polled).json()) as {
      readonly waiting: boolean;
      readonly event: VisualEvent;
    };
    expect(body.waiting).toBe(false);
    expect(body.event).toMatchObject({
      type: "chat.message",
      sequence: 2,
      sessionId: server.started.sessionId,
      payload: { text: "Compare the two delivery designs" },
    });
    socket.close();
  });

  it("replays the in-flight event to a repeated poll", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    await sendChat(socket, "Compare the two delivery designs");

    const first = (await (
      await agentFetch(server, capability, "/api/agent/events?after=0")
    ).json()) as { readonly event: VisualEvent };
    const replay = (await (
      await agentFetch(server, capability, "/api/agent/events?after=0")
    ).json()) as { readonly event: VisualEvent };
    expect(replay.event.eventId).toBe(first.event.eventId);
    expect(server.status().agent.inFlightEventId).toBe(first.event.eventId);
    socket.close();
  });

  it("holds a later chat event while one response is outstanding", async () => {
    const server = await start({ agentPollMs: 60 });
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    await sendChat(socket, "first");
    await sendChat(socket, "second");

    const first = (await (
      await agentFetch(server, capability, "/api/agent/events?after=0")
    ).json()) as { readonly event: VisualEvent };
    expect(first.event.sequence).toBe(2);
    await expect(
      (
        await agentFetch(server, capability, "/api/agent/events?after=2")
      ).json(),
    ).resolves.toMatchObject({ waiting: true });
    expect(server.status().queue.pendingEvents).toBe(2);
    socket.close();
  });

  it("releases the queued chat event once the turn is answered", async () => {
    const server = await start({ agentPollMs: 60 });
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    await sendChat(socket, "first");
    await sendChat(socket, "second");

    const first = (await (
      await agentFetch(server, capability, "/api/agent/events?after=0")
    ).json()) as { readonly event: VisualEvent };
    const answered = await postResponse(
      server,
      capability,
      chatResponse(server, first.event.eventId, 1),
    );
    expect(answered.status).toBe(200);

    const second = (await (
      await agentFetch(server, capability, "/api/agent/events?after=2")
    ).json()) as { readonly waiting: boolean; readonly event: VisualEvent };
    expect(second.waiting).toBe(false);
    expect(second.event.sequence).toBe(3);
    expect(second.event.payload).toEqual({ text: "second" });
    socket.close();
  });

  it("keeps navigation local unless the browser requests agent attention", async () => {
    const server = await start({ agentPollMs: 60 });
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const accepted = nextFrame(socket, "accepted");
    socket.send(
      JSON.stringify({
        type: "view.navigate",
        lastAcknowledgedSequence: 0,
        payload: { viewId: "choices", requiresAttention: false },
      }),
    );
    await accepted;

    await expect(
      (
        await agentFetch(server, capability, "/api/agent/events?after=0")
      ).json(),
    ).resolves.toMatchObject({ waiting: true, lastSequence: 2 });
    const journal = await journalOf(server);
    expect(journal.at(-1)).toMatchObject({ type: "view.navigate" });
    socket.close();
  });

  it("delivers navigation that explicitly requests agent attention", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const accepted = nextFrame(socket, "accepted");
    socket.send(
      JSON.stringify({
        type: "view.navigate",
        lastAcknowledgedSequence: 0,
        payload: { viewId: "choices", requiresAttention: true },
      }),
    );
    await accepted;

    await expect(
      (
        await agentFetch(server, capability, "/api/agent/events?after=0")
      ).json(),
    ).resolves.toMatchObject({
      waiting: false,
      event: { type: "view.navigate" },
    });
    socket.close();
  });

  it("freezes the queue once the pending bound is reached", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    for (let sent = 0; sent < VISUAL_LIMITS.pendingEvents; sent += 1) {
      await sendChat(socket, `message ${sent}`);
    }
    const rejected = nextFrame(socket, "rejected");
    socket.send(
      JSON.stringify({
        type: "chat.message",
        lastAcknowledgedSequence: 0,
        payload: { text: "one more" },
      }),
    );
    expect(await rejected).toMatchObject({ frozen: "pending-events" });

    expect(server.status().queue).toMatchObject({
      pendingEvents: VISUAL_LIMITS.pendingEvents,
      lastSequence: VISUAL_LIMITS.pendingEvents + 1,
      frozen: true,
      frozenReason: "pending-events",
    });
    const events = (await journalOf(server)).filter(
      (record) => record.type === "chat.message",
    );
    expect(events).toHaveLength(VISUAL_LIMITS.pendingEvents);
    socket.close();
  });

  it("rejects a chat message longer than the protocol ceiling", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const rejected = nextFrame(socket, "rejected");
    socket.send(
      JSON.stringify({
        type: "chat.message",
        lastAcknowledgedSequence: 0,
        payload: { text: "x".repeat(VISUAL_LIMITS.messageBytes + 1) },
      }),
    );
    expect((await rejected).diagnostics[0]?.code).toBe("YMVS109");
    const events = (await journalOf(server)).filter(
      (record) => record.type === "chat.message",
    );
    expect(events).toHaveLength(0);
    socket.close();
  });

  it("drops a browser frame beyond the transport ceiling and freezes on bytes", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    socket.send(
      JSON.stringify({
        type: "chat.message",
        lastAcknowledgedSequence: 0,
        payload: { text: "x".repeat(VISUAL_SERVER_LIMITS.browserFrameBytes) },
      }),
    );
    const [code] = (await once(socket, "close")) as [number];
    expect(code).toBe(1009);
    expect(server.status().queue.frozenReason).toBe("message-bytes");
    const events = (await journalOf(server)).filter(
      (record) => record.type === "chat.message",
    );
    expect(events).toHaveLength(0);
  });

  it("rejects a browser frame that is not a valid browser input", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const rejected = nextFrame(socket, "rejected");
    socket.send('{"type":"chat.message"');
    expect((await rejected).diagnostics[0]?.code).toBe("YMVS109");
    socket.close();
  });

  it("rejects a browser input that names a runtime-only event type", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    // The connection is journaled before the frame that forges one arrives.
    await nextFrame(socket, "ready");
    const rejected = nextFrame(socket, "rejected");
    socket.send(
      JSON.stringify({
        type: "browser.connected",
        payload: { connectionId: "forged" },
      }),
    );
    expect((await rejected).diagnostics[0]?.code).toBe("YMVS109");
    // The one connection record this session has is the one the runtime wrote.
    expect(await journalOf(server)).toMatchObject([
      { type: "browser.connected" },
    ]);
    expect(server.status().queue.lastSequence).toBe(1);
    socket.close();
  });

  it("rejects a browser event whose minted identifier repeats", async () => {
    let narrow = 0;
    let wide = 0;
    const server = await start({
      // 16-byte draws mint the session id, the style nonce, the connection id,
      // the record the runtime writes for that connection, and then every
      // browser event id; pinning the draws from the first browser event
      // forces an identifier collision.
      randomBytes: (size: number) => {
        if (size !== 16) {
          wide += 1;
          return Buffer.alloc(size, wide);
        }
        narrow += 1;
        return Buffer.alloc(16, Math.min(narrow, 5));
      },
    });
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    await sendChat(socket, "first");
    const rejected = nextFrame(socket, "rejected");
    socket.send(
      JSON.stringify({
        type: "chat.message",
        lastAcknowledgedSequence: 0,
        payload: { text: "second" },
      }),
    );
    expect((await rejected).diagnostics[0]?.code).toBe("YMVS127");

    const events = (await journalOf(server)).filter(
      (record) => record.type === "chat.message",
    );
    expect(events).toHaveLength(1);
    socket.close();
  });

  it("refuses a browser frame acknowledging a sequence the journal never reached", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const rejected = nextFrame(socket, "rejected");
    socket.send(
      JSON.stringify({
        type: "chat.message",
        lastAcknowledgedSequence: 4,
        payload: { text: "I have seen the future" },
      }),
    );
    expect((await rejected).diagnostics[0]?.code).toBe("YMVS308");
    expect(await journalOf(server)).toMatchObject([
      { type: "browser.connected" },
    ]);
    expect(server.status().queue.lastSequence).toBe(1);
    socket.close();
  });

  it("admits a browser frame whose acknowledgement is merely stale", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    expect((await sendChat(socket, "first")).sequence).toBe(2);

    // The browser is a sequence behind, which is what a reconnect mid-turn
    // looks like; admission still owns the sequence it assigns.
    const accepted = nextFrame(socket, "accepted");
    socket.send(
      JSON.stringify({
        type: "chat.message",
        lastAcknowledgedSequence: 0,
        payload: { text: "second" },
      }),
    );
    expect((await accepted).sequence).toBe(3);
    socket.close();
  });
});

describe("startVisualServer limit failures", () => {
  /**
   * A limit the runtime detects for itself is a runtime that can no longer
   * carry the conversation, so it takes the same terminal transition every
   * other cause takes: once, under a reason that is true of it, with every
   * record the session already accepted left standing.
   */
  const terminals = (records: readonly (VisualEvent | VisualResponse)[]) =>
    records.filter(
      (record) =>
        record.format === "yarramate/visual-event/v1" &&
        record.type === "session.end",
    );

  it("ends a session whose queue reached the pending bound", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const rejections = collectRejections();
    await nextFrame(socket, "ready");
    for (let sent = 0; sent < VISUAL_LIMITS.pendingEvents; sent += 1) {
      await sendChat(socket, `message ${sent}`);
    }
    const rejected = nextFrame(socket, "rejected");
    socket.send(
      JSON.stringify({
        type: "chat.message",
        lastAcknowledgedSequence: 0,
        payload: { text: "one more" },
      }),
    );
    expect(await rejected).toMatchObject({ frozen: "pending-events" });

    // Sequence 1 is the connection, so the bound is reached at 1 + 32 and the
    // terminal record is the one past it.
    const terminal = await waitForVisualEvent(
      server.started.descriptorPath,
      VISUAL_LIMITS.pendingEvents + 1,
      "session.end",
    );
    expect(terminal).toMatchObject({
      sequence: VISUAL_LIMITS.pendingEvents + 2,
      payload: { reason: "server-failed" },
    });
    const journal = await journalOf(server);
    // Nothing the session had already accepted was lost to the failure, and
    // the transition ran exactly once.
    expect(
      journal.filter((record) => record.type === "chat.message"),
    ).toHaveLength(VISUAL_LIMITS.pendingEvents);
    expect(terminals(journal)).toHaveLength(1);

    const closed = await server.stop("server-failed");
    expect(closed.handoff).toMatchObject({
      decision: "failed",
      terminationReason: "server-failed",
      lastSequence: VISUAL_LIMITS.pendingEvents + 2,
    });
    expect(await rejections.settled()).toEqual([]);
  });

  it("unblocks a waiting agent when a browser frame passes the transport ceiling", async () => {
    // Long enough that a poll the failure never settles cannot pass by timing
    // out on its own.
    const server = await start({ agentPollMs: 60_000 });
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const rejections = collectRejections();
    await nextFrame(socket, "ready");
    const polled = agentFetch(server, capability, "/api/agent/events?after=0");
    await waitForAttachedAgent(server);

    socket.send(
      JSON.stringify({
        type: "chat.message",
        lastAcknowledgedSequence: 0,
        payload: { text: "x".repeat(VISUAL_SERVER_LIMITS.browserFrameBytes) },
      }),
    );
    const [code] = (await once(socket, "close")) as [number];
    expect(code).toBe(1009);

    // The child is not left holding a turn on a session that can no longer
    // answer it.
    await expect((await polled).json()).resolves.toMatchObject({
      waiting: true,
    });
    const terminal = await waitForVisualEvent(
      server.started.descriptorPath,
      1,
      "session.end",
    );
    expect(terminal).toMatchObject({
      sequence: 2,
      payload: { reason: "server-failed" },
    });
    expect(server.status().queue.frozenReason).toBe("message-bytes");
    // The socket the ceiling closed is shutdown, not conversation.
    expect(
      (await journalOf(server)).filter(
        (record) => record.type === "browser.disconnected",
      ),
    ).toHaveLength(0);
    expect(await rejections.settled()).toEqual([]);
  });

  it("ends a session whose journal refuses another response", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const rejections = collectRejections();
    const asked = await sendChat(socket, "fill the journal");

    // Responses are the only record a session can grow without bound: the
    // pending queue stops the browser long before 5 MiB of chat.
    const filler = "x".repeat(VISUAL_LIMITS.messageBytes);
    let refused: Response | undefined;
    for (let index = 0; refused === undefined && index < 128; index += 1) {
      const posted = await postResponse(
        server,
        capability,
        chatResponse(server, asked.eventId, 1000 + index, filler),
      );
      if (posted.status === 200) await posted.json();
      else refused = posted;
    }
    expect(refused?.status).toBe(409);
    await expect(refused?.json()).resolves.toMatchObject({
      accepted: false,
      diagnostics: [{ code: "YMVS122" }],
    });

    const terminal = await waitForVisualEvent(
      server.started.descriptorPath,
      2,
      "session.end",
    );
    expect(terminal).toMatchObject({
      sequence: 3,
      payload: { reason: "server-failed" },
    });
    expect(server.status().queue.frozenReason).toBe("transcript-bytes");
    const closed = await server.stop("server-failed");
    expect(closed.handoff).toMatchObject({
      decision: "failed",
      terminationReason: "server-failed",
    });
    expect(await rejections.settled()).toEqual([]);
    socket.close();
  }, 120_000);
});

describe("startVisualServer agent responses", () => {
  it("journals and broadcasts an agent response to the browser", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const accepted = await sendChat(socket, "first");

    const broadcast = nextFrame(socket, "response");
    const posted = await postResponse(
      server,
      capability,
      chatResponse(server, accepted.eventId, 1),
    );
    expect(posted.status).toBe(200);
    await expect(posted.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
    });
    expect((await broadcast).response).toMatchObject({ type: "chat.response" });
    socket.close();
  });

  it("suppresses a duplicate agent response", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const accepted = await sendChat(socket, "first");
    const response = chatResponse(server, accepted.eventId, 1);

    await postResponse(server, capability, response);
    const repeated = await postResponse(server, capability, response);
    expect(repeated.status).toBe(200);
    await expect(repeated.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: true,
    });
    const journaled = (await journalOf(server)).filter(
      (record) => record.format === "yarramate/visual-response/v1",
    );
    expect(journaled).toHaveLength(1);
    socket.close();
  });

  it("rejects a response body that is not JSON content", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const response = await agentFetch(
      server,
      capability,
      "/api/agent/responses",
      {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "chat.response",
      },
    );
    expect(response.status).toBe(415);
    expect(await journalOf(server)).toHaveLength(0);
  });

  it("rejects a response body beyond the byte ceiling", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const response = await agentFetch(
      server,
      capability,
      "/api/agent/responses",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: `{"padding":"${"x".repeat(VISUAL_SERVER_LIMITS.agentBodyBytes)}"}`,
      },
    );
    expect(response.status).toBe(413);
    expect(await journalOf(server)).toHaveLength(0);
  });

  it("rejects a response that violates the protocol schema", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const empty: VisualResponse = {
      format: "yarramate/visual-response/v1",
      sessionId: server.started.sessionId,
      responseId: identifier(1),
      eventId: identifier(9),
      type: "chat.response",
      timestamp: "2026-08-08T00:00:02.000Z",
      // Empty text violates the schema's minLength, which no type can catch.
      payload: { text: "" },
    };
    const response = await postResponse(server, capability, empty);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ accepted: false });
    expect(await journalOf(server)).toHaveLength(0);
  });

  it("rejects a response belonging to another session", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const response = await postResponse(server, capability, {
      ...chatResponse(server, identifier(9), 1),
      sessionId: identifier(7),
    });
    expect(response.status).toBe(409);
    expect(await journalOf(server)).toHaveLength(0);
  });

  it("rejects a response that answers an event this session never journaled", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    await sendChat(socket, "first");

    // The capability is this session's, and so is the session id; the event
    // being answered is not.
    const response = await postResponse(
      server,
      capability,
      chatResponse(server, identifier(0xbad), 1),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      diagnostics: [{ code: "YMVS131", pointer: "/eventId" }],
    });
    // The connection this browser opened, and the one message it sent.
    expect(await journalOf(server)).toHaveLength(2);
    socket.close();
  });
});

describe("startVisualServer static asset confinement", () => {
  it("denies a percent-encoded traversal out of the asset root", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const response = await fetch(
      `${server.started.origin}/assets/%2e%2e%2f%2e%2e%2foutside-asset-root.txt`,
      { headers: { Cookie: cookie } },
    );
    expect(response.status).toBe(404);
  });

  it("denies a traversal that lands back inside the asset root", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    // The resolved path is a served file and its extension is whitelisted, so
    // only the flat-name rule can refuse this one.
    const response = await fetch(
      `${server.started.origin}/assets/%2e%2e%2findex.html`,
      { headers: { Cookie: cookie } },
    );
    expect(response.status).toBe(404);
  });

  it("denies an unnormalised traversal sent on the wire", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const text = await rawRequest(server.started.origin, [
      "GET /assets/../../outside-asset-root.txt HTTP/1.1",
      `Host: 127.0.0.1:${new URL(server.started.origin).port}`,
      `Cookie: ${cookie}`,
      "Connection: close",
    ]);
    expect(text.split("\r\n")[0]).toContain("404");
    expect(text).not.toContain("outside-asset-root:");
  });

  it("denies a symlinked asset", async () => {
    const root = await mkdtemp(join(tmpdir(), "yarramate-visual-assets-"));
    const outside = join(root, "secret.txt");
    await writeFile(outside, "agent capability", { mode: 0o600 });
    const served = join(root, "browser-assets");
    await mkdir(join(served, "assets"), { recursive: true });
    await writeFile(join(served, "index.html"), "<!doctype html>");
    await symlink(outside, join(served, "assets", "leak-0000.js"));

    const server = await start({ assetRoot: served });
    const { cookie } = await bootstrap(server);
    const response = await fetch(
      `${server.started.origin}/assets/leak-0000.js`,
      { headers: { Cookie: cookie } },
    );
    expect(response.status).toBe(404);
    await rm(root, { recursive: true, force: true });
  });

  it("denies an unknown route", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const response = await fetch(`${server.started.origin}/admin`, {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(404);
  });
});

describe("startVisualServer lifecycle", () => {
  it("writes a private descriptor carrying only the agent capability", async () => {
    const server = await start();
    const descriptor: unknown = JSON.parse(
      await readFile(nativePath(server.started.descriptorPath), "utf8"),
    );
    expect(descriptor).toMatchObject({
      format: "yarramate/visual-session-descriptor/v2",
      protocolVersion: "yarramate/visual-protocol/v5",
      sessionId: server.started.sessionId,
      origin: server.started.origin,
      sessionRoot: server.started.sessionRoot,
    });
    const token = new URL(server.started.browserUrl).searchParams.get(
      "key",
    ) as string;
    expect(JSON.stringify(descriptor)).not.toContain(token);
    if (process.platform !== "win32") {
      expect(
        (await stat(nativePath(server.started.descriptorPath))).mode & 0o777,
      ).toBe(
        0o600,
      );
    }
  });

  it("binds only the loopback interface on an ephemeral port", async () => {
    const server = await start();
    expect(server.started.origin).toMatch(/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/);
    expect(server.started.webSocketUrl).toMatch(
      /^ws:\/\/127\.0\.0\.1:[0-9]{1,5}\/socket$/,
    );
    expect(Number(new URL(server.started.origin).port)).toBeGreaterThan(0);
  });

  it("recovers the handoff before deleting the session", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const accepted = await sendChat(socket, "first");
    await postResponse(
      server,
      capability,
      chatResponse(server, accepted.eventId, 1),
    );
    const root = nativePath(server.started.sessionRoot);

    const closed = await server.stop("user-ended");
    expect(closed).toMatchObject({
      reason: "user-ended",
      alreadyStopped: false,
    });
    expect(closed.handoff).toMatchObject({
      format: "yarramate/visual-handoff/v2",
      sessionId: server.started.sessionId,
      // The reviewer's own End was never journaled here, so the shutdown's
      // terminal event is the record past the chat it recovered.
      lastSequence: accepted.sequence + 1,
    });
    await expect(stat(root)).rejects.toThrow();
    await expect(server.closed).resolves.toMatchObject({
      reason: "user-ended",
    });
  });

  it("answers a repeated stop idempotently", async () => {
    const server = await start();
    const first = await server.stop("user-ended");
    const second = await server.stop("main-cancelled");
    expect(second.alreadyStopped).toBe(true);
    expect(second.reason).toBe("user-ended");
    expect(second.handoff?.sessionId).toBe(first.handoff?.sessionId);
    expect(server.status()).toMatchObject({
      lifecycle: "stopped",
      alreadyStopped: true,
      server: { listening: false },
    });
  });

  it("stops on the agent stop route and closes the listener", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const response = await agentFetch(server, capability, "/api/agent/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "user-ended" }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      reason: "user-ended",
      alreadyStopped: false,
      handoff: { format: "yarramate/visual-handoff/v2" },
    });
    await server.closed;
    await expect(
      fetch(`${server.started.origin}/api/agent/status`),
    ).rejects.toThrow();
  });

  it("answers every concurrent agent stop request before closing sockets", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const port = Number(new URL(server.started.origin).port);
    const sockets = Array.from({ length: 4 }, () => connect(port, "127.0.0.1"));
    await Promise.all(sockets.map((socket) => once(socket, "connect")));
    const body = JSON.stringify({ reason: "user-ended" });
    const responses = sockets.map(
      (socket) =>
        new Promise<string>((resolve, reject) => {
          let response = "";
          socket.setEncoding("utf8");
          socket.on("data", (chunk) => {
            response += chunk;
          });
          socket.on("end", () => resolve(response));
          socket.on("error", reject);
          socket.write(
            [
              "POST /api/agent/stop HTTP/1.1",
              `Host: 127.0.0.1:${port}`,
              `Authorization: Bearer ${capability}`,
              "Content-Type: application/json",
              `Content-Length: ${Buffer.byteLength(body)}`,
              "Connection: close",
              "",
              body,
            ].join("\r\n"),
          );
        }),
    );

    const raw = await Promise.all(responses);
    expect(raw.map((response) => response.split("\r\n")[0])).toEqual([
      "HTTP/1.1 200 OK",
      "HTTP/1.1 200 OK",
      "HTTP/1.1 200 OK",
      "HTTP/1.1 200 OK",
    ]);
    const results = raw.map(
      (response) =>
        JSON.parse(response.split("\r\n\r\n")[1] ?? "{}") as {
          readonly alreadyStopped: boolean;
        },
    );
    expect(results.filter((result) => !result.alreadyStopped)).toHaveLength(1);
    expect(results.filter((result) => result.alreadyStopped)).toHaveLength(3);
  });

  it("settles a waiting long poll when the session stops", async () => {
    // Long enough that a poll the stop never settles cannot pass by timing out.
    const server = await start({ agentPollMs: 60_000 });
    const capability = await capabilityOf(server);
    const polled = agentFetch(server, capability, "/api/agent/events?after=0");
    // The poll has to be registered before the stop reaches it. Authenticating
    // the capability and adding the poll are one synchronous step, so an
    // attached agent is that registration, observed in this process.
    await waitForAttachedAgent(server);
    await server.stop("main-cancelled");
    await expect((await polled).json()).resolves.toMatchObject({
      waiting: true,
    });
  });

  it("closes browser sockets with a closing frame", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    await nextFrame(socket, "ready");
    const closing = nextFrame(socket, "closing");
    const ended = once(socket, "close");
    await server.stop("main-cancelled");
    expect(await closing).toMatchObject({ reason: "main-cancelled" });
    await ended;
  });

  it("journals the browser connection the runtime admitted", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const ready = await nextFrame(socket, "ready");
    // The record is journaled before the snapshot is handed over, so the
    // sequence the browser starts from already counts its own arrival.
    expect(ready.snapshot.lastSequence).toBe(1);
    expect(server.status().browser).toMatchObject({
      connected: true,
      connections: 1,
    });
    const opened = await journalOf(server);
    const connected = opened[0];
    if (
      connected?.format !== "yarramate/visual-event/v1" ||
      connected.type !== "browser.connected"
    ) {
      throw new Error("the session journaled no browser connection");
    }
    expect(connected).toMatchObject({
      sessionId: server.started.sessionId,
      sequence: 1,
    });
    // Every field the browser is not allowed to choose was minted here.
    expect(connected.eventId).toMatch(/^[0-9a-f]{32}$/);
    expect(connected.timestamp).toMatch(
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/,
    );

    socket.close(1000);
    await once(socket, "close");
    await waitForSequence(server, 2);

    const journal = await journalOf(server);
    expect(journal).toHaveLength(2);
    // One connection, one identifier: the pair names the same socket, and the
    // close code the transport reported is the one the record carries.
    expect(journal[1]).toMatchObject({
      format: "yarramate/visual-event/v1",
      type: "browser.disconnected",
      sequence: 2,
      payload: { connectionId: connected.payload.connectionId, code: 1000 },
    });
    const idle = server.status();
    expect(idle.browser).toMatchObject({ connected: false, connections: 0 });
    expect(idle.browser.graceExpiresAt).toMatch(
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/,
    );
  });

  it("does not admit a browser whose connected event cannot be journaled", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    await chmod(
      join(nativePath(server.started.sessionRoot), "journal.jsonl"),
      0o400,
    );

    const socket = await openBrowserSocket(server, cookie);
    await once(socket, "close");

    expect(server.status()).toMatchObject({
      browser: { connected: false, connections: 0 },
      queue: { lastSequence: 0 },
    });
    expect(await journalOf(server)).toEqual([]);
  });

  it("never opens an agent turn for a browser lifecycle record", async () => {
    const server = await start({ agentPollMs: 60 });
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    await nextFrame(socket, "ready");
    socket.close(1000);
    await once(socket, "close");
    await waitForSequence(server, 2);

    await expect(
      (
        await agentFetch(server, capability, "/api/agent/events?after=0")
      ).json(),
    ).resolves.toEqual({ waiting: true, lastSequence: 2, pendingEvents: 0 });
    expect(server.status()).toMatchObject({
      agent: { attached: true, inFlightEventId: null },
      queue: { pendingEvents: 0, lastSequence: 2, frozen: false },
    });
  });

  it("journals no disconnection for a socket the shutdown closed", async () => {
    const server = await start({ includeTranscript: true });
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    await nextFrame(socket, "ready");
    const ended = once(socket, "close");

    const closed = await server.stop("user-ended");
    await ended;

    // The transcript recovery read is the whole record: one arrival, then the
    // record that closed the session, and no shutdown noise behind it.
    expect(
      (closed.handoff?.transcript ?? []).map((record) => record.type),
    ).toEqual(["browser.connected", "session.end"]);
  });
});

describe("startVisualServer shutdown and admission races", () => {
  it("never journals a browser frame that raced the stop it lost", async () => {
    const server = await start({ includeTranscript: true });
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const rejections = collectRejections();

    // Enqueued, unacknowledged, and deliberately not awaited: every frame is
    // already on the admission chain when the stop begins.
    for (let sent = 0; sent < 8; sent += 1) {
      socket.send(
        JSON.stringify({
          type: "chat.message",
          lastAcknowledgedSequence: 0,
          payload: { text: `race ${sent}` },
        }),
      );
    }
    const closed = await server.stop("main-cancelled");

    expect(closed).toMatchObject({
      reason: "main-cancelled",
      alreadyStopped: false,
    });
    expect(closed.handoff).toBeDefined();
    // Recovery must observe a settled journal: every sequence it counted is a
    // record it could actually read.
    const events = (closed.handoff?.transcript ?? []).filter(
      (record) => record.format === "yarramate/visual-event/v1",
    );
    expect(events).toHaveLength(closed.handoff?.lastSequence ?? -1);
    await expect(server.closed).resolves.toMatchObject({
      reason: "main-cancelled",
    });
    await expect(server.stop("user-ended")).resolves.toMatchObject({
      alreadyStopped: true,
      reason: "main-cancelled",
    });
    expect(server.status()).toMatchObject({
      lifecycle: "stopped",
      alreadyStopped: true,
    });
    // Nothing may recreate the session directory after recovery deleted it.
    await expect(
      stat(nativePath(server.started.sessionRoot)),
    ).rejects.toThrow();
    expect(await rejections.settled()).toEqual([]);
  });

  it("tells the browser when admitting its frame fails", async () => {
    let narrow = 0;
    const server = await start({
      // 16-byte draws mint the session id, the style nonce, the connection id,
      // the record the runtime writes for that connection, then browser event
      // identifiers; failing from the first of those makes admission throw
      // inside the socket's own fire-and-forget handler.
      randomBytes: (size: number) => {
        if (size !== 16) return randomBytes(size);
        narrow += 1;
        if (narrow >= 5) throw new Error("random source unavailable");
        return randomBytes(16);
      },
    });
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const rejections = collectRejections();

    const rejected = nextFrame(socket, "rejected");
    socket.send(
      JSON.stringify({
        type: "chat.message",
        lastAcknowledgedSequence: 0,
        payload: { text: "unminted" },
      }),
    );

    expect((await rejected).diagnostics[0]?.code).toBe("YMVS307");
    // Nothing but the connection the runtime journaled for itself.
    expect(await journalOf(server)).toMatchObject([
      { type: "browser.connected" },
    ]);
    // The session survives a failed admission and still answers.
    expect(server.status().lifecycle).toBe("running");
    expect(await rejections.settled()).toEqual([]);
  });

  it("never journals a frame sent after the drain began", async () => {
    const server = await start({ includeTranscript: true });
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    await sendChat(socket, "in time");
    const rejections = collectRejections();

    // The stop marks the session draining and starts the socket's closing
    // handshake synchronously, but the client is still OPEN for a moment: a
    // frame written now can reach a session that is already recovering.
    const stopping = server.stop("main-cancelled");
    socket.send(
      JSON.stringify({
        type: "chat.message",
        lastAcknowledgedSequence: 0,
        payload: { text: "too late" },
      }),
    );
    const closed = await stopping;

    const texts = (closed.handoff?.transcript ?? [])
      .filter((record) => record.type === "chat.message")
      .map((record) => JSON.stringify(record.payload));
    expect(texts).toEqual([JSON.stringify({ text: "in time" })]);
    await expect(
      stat(nativePath(server.started.sessionRoot)),
    ).rejects.toThrow();
    expect(await rejections.settled()).toEqual([]);
  });
});

describe("startVisualServer diagnostic conformance", () => {
  /**
   * Every diagnostic the runtime publishes is read back by the one-shot agent
   * clients inside a `visual-diagnostic-result/v1` document, so each refusal
   * surface has to emit diagnostics that document already accepts — including
   * the RFC 6901 pointers it requires.
   */
  const publishable = (diagnostics: unknown): readonly VisualDiagnostic[] => {
    const parsed = parseVisualDiagnosticResult({
      format: "yarramate/visual-diagnostic-result/v1",
      diagnostics,
    });
    if (!parsed.ok) {
      throw new Error(
        `diagnostics are not publishable: ${JSON.stringify(diagnostics)} (${parsed.diagnostics[0]?.message})`,
      );
    }
    return parsed.value.diagnostics;
  };

  const diagnosticsOf = (document: unknown): unknown => {
    if (
      typeof document === "object" &&
      document !== null &&
      "diagnostics" in document
    ) {
      return document.diagnostics;
    }
    throw new Error(
      `answer carries no diagnostics: ${JSON.stringify(document)}`,
    );
  };

  it("publishes a schema refusal as a diagnostic result", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const empty: VisualResponse = {
      format: "yarramate/visual-response/v1",
      sessionId: server.started.sessionId,
      responseId: identifier(1),
      eventId: identifier(9),
      type: "chat.response",
      timestamp: "2026-08-08T00:00:02.000Z",
      // Empty text violates the schema's minLength, which no type can catch.
      payload: { text: "" },
    };
    const response = await postResponse(server, capability, empty);
    expect(response.status).toBe(400);
    expect(
      publishable(diagnosticsOf(await response.json())).length,
    ).toBeGreaterThan(0);
  });

  it("publishes a foreign-session refusal as a diagnostic result", async () => {
    const server = await start();
    const capability = await capabilityOf(server);
    const response = await postResponse(server, capability, {
      ...chatResponse(server, identifier(9), 1),
      sessionId: identifier(7),
    });
    expect(response.status).toBe(409);
    const diagnostics = publishable(diagnosticsOf(await response.json()));
    expect(diagnostics[0]).toMatchObject({
      code: "YMVS126",
      pointer: "/sessionId",
    });
  });

  it("publishes a rejected browser frame as a diagnostic result", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const rejected = nextFrame(socket, "rejected");
    socket.send(
      JSON.stringify({
        type: "chat.message",
        lastAcknowledgedSequence: 0,
        payload: {},
      }),
    );
    expect(publishable((await rejected).diagnostics).length).toBeGreaterThan(0);
    socket.close();
  });

  it("publishes a frozen-queue refusal as a diagnostic result", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    for (let sent = 0; sent < VISUAL_LIMITS.pendingEvents; sent += 1) {
      await sendChat(socket, `message ${sent}`);
    }
    const rejected = nextFrame(socket, "rejected");
    socket.send(
      JSON.stringify({
        type: "chat.message",
        lastAcknowledgedSequence: 0,
        payload: { text: "one more" },
      }),
    );
    const diagnostics = publishable((await rejected).diagnostics);
    expect(diagnostics[0]).toMatchObject({
      code: "YMVS305",
      pointer: "/sequence",
    });
    socket.close();
  });
});

describe("startVisualServer teardown retries", () => {
  /**
   * The teardown is failed through the filesystem rather than the clock: a
   * session root nothing may unlink from refuses the removal a stop ends with,
   * refuses it on every attempt, and stops refusing the moment the permission
   * comes back. A process the permission does not bind cannot see any of it.
   */
  const enforcesPermissions =
    process.platform !== "win32" && process.getuid?.() !== 0;

  it.skipIf(!enforcesPermissions)(
    "retries a teardown the first stop failed to finish",
    async () => {
      const server = await start();
      const root = nativePath(server.started.sessionRoot);
      // Readable and traversable, so the recovery the stop reads still
      // succeeds; not writable, so the removal that follows it cannot.
      await chmod(root, 0o500);

      await expect(server.stop("user-ended")).rejects.toThrow();
      // Nothing was lost to the failure: the journal the retry recovers from
      // is still the one this session wrote.
      await expect(stat(join(root, "journal.jsonl"))).resolves.toBeDefined();

      await chmod(root, 0o700);
      const closed = await server.stop("user-ended");

      expect(closed).toMatchObject({
        reason: "user-ended",
        alreadyStopped: false,
      });
      expect(closed.handoff).toMatchObject({
        format: "yarramate/visual-handoff/v2",
        sessionId: server.started.sessionId,
      });
      await expect(stat(root)).rejects.toThrow();
      await expect(server.closed).resolves.toMatchObject({
        reason: "user-ended",
      });
      expect(server.status()).toMatchObject({
        lifecycle: "stopped",
        server: { listening: false },
      });
    },
  );
});

describe("startVisualServer session start views list", () => {
  const document = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: user
    kind: businessActor
    name: User
relationships: []
`;
  const validProjection = `format: yarramate/projection/v1
id: valid-view
version: "1.0"
query:
  kinds: [yarramate/core@0.1#businessActor]
presentation:
  title: Valid View
`;
  // Fails loadProjection's schema check: an empty \`subjects\` array violates
  // \`minItems: 1\`, same as the view.save rejection test above.
  const invalidProjection = `format: yarramate/projection/v1
id: invalid-view
version: "1.0"
query:
  subjects: []
presentation:
  title: Invalid View
`;
  const manifest = `format: yarramate/workspace/v1
id: views-fixture
documents:
  - architecture/main.yaml
profiles: []
projections:
  - projections/valid-view.yaml
  - projections/invalid-view.yaml
adapterMappings: []
evidence: []
`;

  it("skips a projection failing schema validation, keeping the valid survivors", async () => {
    await mkdir(join(baseDir, ".yarramate/architecture"), { recursive: true });
    await mkdir(join(baseDir, ".yarramate/projections"), { recursive: true });
    await writeFile(
      join(baseDir, ".yarramate/architecture/main.yaml"),
      document,
      "utf8",
    );
    await writeFile(
      join(baseDir, ".yarramate/projections/valid-view.yaml"),
      validProjection,
      "utf8",
    );
    await writeFile(
      join(baseDir, ".yarramate/projections/invalid-view.yaml"),
      invalidProjection,
      "utf8",
    );

    await writeFile(
      join(baseDir, ".yarramate/workspace.yaml"),
      manifest,
      "utf8",
    );

    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const ready = await nextFrame(socket, "ready");

    expect(ready.snapshot.views).toEqual([
      {
        id: "valid-view",
        title: "Valid View",
        description: "",
        query: { kinds: ["yarramate/core@0.1#businessActor"] },
        presentation: { title: "Valid View" },
        // The path the tree derives its folders from, and what this view's
        // query matches in this workspace: one businessActor.
        path: ".yarramate/projections/valid-view.yaml",
        subjectCount: 1,
      },
    ]);
    socket.close();
  });

  it("counts the concepts a view matches, not the relationships alongside them", async () => {
    await mkdir(join(baseDir, ".yarramate/architecture"), { recursive: true });
    await mkdir(join(baseDir, ".yarramate/projections"), { recursive: true });
    // Two concepts and the relationship between them. A count taken from the
    // match set would read three; the canvas draws two boxes.
    await writeFile(
      join(baseDir, ".yarramate/architecture/main.yaml"),
      `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: checkout
    kind: applicationComponent
    name: Checkout
  - id: ledger
    kind: applicationComponent
    name: Ledger
relationships:
  - id: ledger-serves-checkout
    kind: serving
    from: ledger
    to: checkout
`,
      "utf8",
    );
    await writeFile(
      join(baseDir, ".yarramate/projections/apps.yaml"),
      `format: yarramate/projection/v1
id: apps
version: "1.0"
query:
  kinds: [yarramate/core@0.1#applicationComponent]
  relationships: between
presentation:
  title: Apps
`,
      "utf8",
    );
    await writeFile(
      join(baseDir, ".yarramate/workspace.yaml"),
      `format: yarramate/workspace/v1
id: counting-fixture
documents:
  - architecture/main.yaml
profiles: []
projections:
  - projections/apps.yaml
adapterMappings: []
evidence: []
`,
      "utf8",
    );

    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const ready = await nextFrame(socket, "ready");

    expect(ready.snapshot.views[0]?.subjectCount).toBe(2);
    socket.close();
  });

  it("ships the interrogation overlay from the shipped catalogue (#292)", async () => {
    await mkdir(join(baseDir, ".yarramate/architecture"), { recursive: true });
    await writeFile(
      join(baseDir, ".yarramate/architecture/main.yaml"),
      `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: checkout
    kind: applicationComponent
    name: Checkout
relationships: []
`,
      "utf8",
    );
    await writeFile(
      join(baseDir, ".yarramate/workspace.yaml"),
      `format: yarramate/workspace/v1
id: overlay-fixture
documents:
  - architecture/main.yaml
profiles: []
projections: []
adapterMappings: []
evidence: []
`,
      "utf8",
    );

    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const ready = await nextFrame(socket, "ready");

    // Presence and shape, never counts: those move with the catalogue
    // version, and pinning them fails every honest deepening (ADR 0063).
    const overlay = ready.snapshot.model.interrogation;
    expect(overlay).toBeDefined();
    expect(overlay!.catalogue).toMatch(/^core-enrichment@/);
    expect(overlay!.workspace.length).toBeGreaterThan(0);
    socket.close();
  });
});

describe("startVisualServer filter.query", () => {
  // Same small workspace ask-command.test.ts compiles: one businessActor, two
  // planned concepts, and a build-order relationship between them, so a
  // `kinds` filter has an unambiguous single match to assert against.
  const document = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: user
    kind: businessActor
    name: User
  - id: todo-service
    kind: applicationService
    name: Todo service
    status: planned
relationships:
  - id: service-serves-user
    kind: serving
    from: todo-service
    to: user
`;
  const manifest = `format: yarramate/workspace/v1
id: filter-fixture
documents:
  - architecture/main.yaml
profiles: []
projections: []
adapterMappings: []
evidence: []
`;

  const withWorkspace = async () => {
    await mkdir(join(baseDir, ".yarramate/architecture"), { recursive: true });
    await writeFile(
      join(baseDir, ".yarramate/architecture/main.yaml"),
      document,
      "utf8",
    );
    await writeFile(
      join(baseDir, ".yarramate/workspace.yaml"),
      manifest,
      "utf8",
    );
  };

  const sendFilterQuery = (
    socket: WebSocket,
    query: {
      readonly kinds?: readonly string[];
      readonly subjects?: readonly string[];
      readonly statuses?: readonly string[];
    },
  ) => {
    const result = nextFrame(socket, "filter-result");
    socket.send(
      JSON.stringify({
        type: "filter.query",
        lastAcknowledgedSequence: 0,
        payload: { query },
      }),
    );
    return result;
  };

  it("resolves matching subject ids against the compiled workspace", async () => {
    await withWorkspace();
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);

    const frame = await sendFilterQuery(socket, {
      kinds: ["yarramate/core@0.1#businessActor"],
    });

    expect(frame.result).toEqual({
      query: { kinds: ["yarramate/core@0.1#businessActor"] },
      matchedIds: ["user"],
      // The editor asks why a subject is not on the canvas, and the runtime is
      // the only side that can answer: the query needs the semantic graph, and
      // the browser holds the rendered model (#248).
      excluded: [{ id: "todo-service", facet: "kinds" }],
    });
    socket.close();
  });

  it("names the FIRST facet that dropped each subject, not every facet that would", async () => {
    await withWorkspace();
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);

    // The actor fails both facets. `subjects` is checked first, so that is
    // what it is reported against: a list of every reason is a list nobody
    // reads. The service passes `subjects` and is dropped by `statuses`,
    // which is planned rather than current.
    const frame = await sendFilterQuery(socket, {
      subjects: ["todo-service"],
      statuses: ["current"],
    });

    expect(frame.result.matchedIds).toEqual([]);
    expect(
      Object.fromEntries(
        frame.result.excluded.map(({ id, facet }) => [id, facet]),
      ),
    ).toEqual({ user: "subjects", "todo-service": "statuses" });
    socket.close();
  });

  it("reports no exclusions for a query that keeps everything", async () => {
    await withWorkspace();
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);

    const frame = await sendFilterQuery(socket, {});

    expect(frame.result.excluded).toEqual([]);
    socket.close();
  });

  it("returns no matches for an ad-hoc session with no resolved workspace", async () => {
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);

    const frame = await sendFilterQuery(socket, {
      kinds: ["yarramate/core@0.1#businessActor"],
    });

    expect(frame.result).toEqual({
      query: { kinds: ["yarramate/core@0.1#businessActor"] },
      matchedIds: [],
      // Nothing compiled is nothing to explain, not "the query dropped
      // everything": there is no graph to have dropped anything from.
      excluded: [],
    });
    socket.close();
  });

  it("journals the query for audit without waking the agent poll loop", async () => {
    await withWorkspace();
    const server = await start({ agentPollMs: 60 });
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);

    await sendFilterQuery(socket, {
      kinds: ["yarramate/core@0.1#businessActor"],
    });

    const journal = await journalOf(server);
    expect(journal.at(-1)).toMatchObject({
      type: "filter.query",
      payload: {
        query: { kinds: ["yarramate/core@0.1#businessActor"] },
      },
    });
    // Non-actionable: the poll loop never saw it, so a poll from before the
    // journal's start is still waiting rather than replaying it.
    await expect(
      (
        await agentFetch(server, capability, "/api/agent/events?after=0")
      ).json(),
    ).resolves.toMatchObject({ waiting: true, lastSequence: 2 });
    socket.close();
  });
});

describe("startVisualServer chat applied query", () => {
  // The same fixture the panel filter resolves against, so the two paths can
  // be asserted to agree on one query rather than on two similar ones.
  const document = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: user
    kind: businessActor
    name: User
  - id: todo-service
    kind: applicationService
    name: Todo service
    status: planned
relationships:
  - id: service-serves-user
    kind: serving
    from: todo-service
    to: user
`;
  const manifest = `format: yarramate/workspace/v1
id: chat-filter-fixture
documents:
  - architecture/main.yaml
profiles: []
projections: []
adapterMappings: []
evidence: []
`;

  const withWorkspace = async () => {
    await mkdir(join(baseDir, ".yarramate/architecture"), { recursive: true });
    await writeFile(
      join(baseDir, ".yarramate/architecture/main.yaml"),
      document,
      "utf8",
    );
    await writeFile(
      join(baseDir, ".yarramate/workspace.yaml"),
      manifest,
      "utf8",
    );
  };

  const chatFilter = (
    handle: VisualServerHandle,
    eventId: string,
    appliedQuery: VisualChatAppliedQuery,
  ): VisualResponse => ({
    format: "yarramate/visual-response/v1",
    sessionId: handle.started.sessionId,
    responseId: identifier(1),
    eventId,
    type: "chat.response",
    timestamp: "2026-08-08T00:00:02.000Z",
    payload: { text: "Showing the actors.", appliedQuery },
  });

  it("resolves the agent's query against the compiled graph", async () => {
    await withWorkspace();
    const server = await start();
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const accepted = await sendChat(socket, "show me the actors");

    const broadcast = nextFrame(socket, "response");
    const posted = await postResponse(
      server,
      capability,
      chatFilter(server, accepted.eventId, {
        query: { kinds: ["yarramate/core@0.1#businessActor"] },
      }),
    );

    expect(posted.status).toBe(200);
    // The identical assertion the panel's `filter.query` test makes, reached
    // through chat: one evaluator, one graph, one answer.
    expect((await broadcast).response).toMatchObject({
      type: "chat.response",
      payload: {
        appliedQuery: {
          query: { kinds: ["yarramate/core@0.1#businessActor"] },
          matchedIds: ["user"],
        },
      },
    });
    // Journaled resolved, so a replay highlights what the reviewer saw.
    expect((await journalOf(server)).at(-1)).toMatchObject({
      type: "chat.response",
      payload: { appliedQuery: { matchedIds: ["user"] } },
    });
    socket.close();
  });

  it("forwards a query that resolves to nothing as an empty match", async () => {
    await withWorkspace();
    const server = await start();
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const accepted = await sendChat(socket, "show me the retired parts");

    const broadcast = nextFrame(socket, "response");
    await postResponse(
      server,
      capability,
      chatFilter(server, accepted.eventId, {
        query: { statuses: ["retired"] },
      }),
    );

    // An empty resolution still lands: the reviewer sees their filter selected
    // nothing rather than watching the previous one stay lit.
    expect((await broadcast).response).toMatchObject({
      payload: { appliedQuery: { matchedIds: [] } },
    });
    socket.close();
  });

  it("refuses a chat response that asserts its own match set", async () => {
    await withWorkspace();
    const server = await start();
    const capability = await capabilityOf(server);
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const accepted = await sendChat(socket, "show me the actors");

    const posted = await postResponse(
      server,
      capability,
      chatFilter(server, accepted.eventId, {
        query: { kinds: ["yarramate/core@0.1#businessActor"] },
        matchedIds: ["user"],
      }),
    );

    expect(posted.status).toBe(400);
    await expect(posted.json()).resolves.toMatchObject({
      accepted: false,
      diagnostics: [
        { code: "YMVS311", pointer: "/payload/appliedQuery/matchedIds" },
      ],
    });
    // Refused before the append: nothing about the turn was recorded.
    expect(
      (await journalOf(server)).filter(
        (record) => record.format === "yarramate/visual-response/v1",
      ),
    ).toHaveLength(0);
    socket.close();
  });
});

/**
 * Saving a view is a row in a changeset, not a write of its own (ADR 0103).
 * These replace the `view.save` round-trip tests: the event is gone, and what
 * matters now is that a view and the model land in ONE batch, that a view
 * answers to the same staleness pin every other document does, and that a
 * removal is refused rather than half-applied.
 */
describe("startVisualServer staged view operations", () => {
  const document = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: user
    kind: businessActor
    name: User
relationships: []
`;
  const manifest = `format: yarramate/workspace/v1
id: save-fixture
documents:
  - architecture/main.yaml
profiles: []
projections:
  - projections/*.yaml
adapterMappings: []
evidence: []
`;
  const seeded = `format: yarramate/projection/v1
id: seeded
version: '1.0'
query:
  kinds:
    - yarramate/core@0.1#businessActor
presentation:
  title: Seeded
  description: A view that already exists
`;

  const withWorkspace = async () => {
    await mkdir(join(baseDir, ".yarramate/architecture"), { recursive: true });
    await mkdir(join(baseDir, ".yarramate/projections"), { recursive: true });
    await writeFile(
      join(baseDir, ".yarramate/architecture/main.yaml"),
      document,
      "utf8",
    );
    await writeFile(
      join(baseDir, ".yarramate/projections/seeded.yaml"),
      seeded,
      "utf8",
    );
    await writeFile(
      join(baseDir, ".yarramate/workspace.yaml"),
      manifest,
      "utf8",
    );
  };

  const projection = (id: string, title: string) => ({
    format: "yarramate/projection/v1" as const,
    id,
    version: "1.0",
    query: { kinds: ["yarramate/core@0.1#businessActor"] },
    presentation: { title, description: "staged" },
  });

  /** A commit carrying whatever mix of the two lists a test needs. */
  const sendCommit = (
    socket: WebSocket,
    payload: {
      readonly operations?: readonly unknown[];
      readonly viewOperations?: readonly unknown[];
      readonly sourceDigests?: Readonly<Record<string, string>>;
    },
  ) => {
    const result = nextFrame(socket, "apply-result");
    socket.send(
      JSON.stringify({
        type: "changeset.commit",
        lastAcknowledgedSequence: 0,
        payload: {
          operations: payload.operations ?? [],
          viewOperations: payload.viewOperations ?? [],
          sourceDigests: payload.sourceDigests ?? {},
        },
      }),
    );
    return result;
  };

  const digestOfFile = async (path: string): Promise<string> =>
    createHash("sha256")
      .update(await readFile(join(baseDir, path), "utf8"), "utf8")
      .digest("hex");

  const sessionViews = async (
    server: Awaited<ReturnType<typeof start>>,
    cookie: string,
  ) => {
    const body = (await (
      await fetch(`${server.started.origin}/api/session`, {
        headers: { Cookie: cookie },
      })
    ).json()) as { readonly views: readonly VisualViewSummary[] };
    return body.views;
  };

  it("writes a projection a commit staged", async () => {
    await withWorkspace();
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);

    const frame = await sendCommit(socket, {
      viewOperations: [
        {
          op: "write-view",
          path: ".yarramate/projections/my-view.yaml",
          projection: projection("my-view", "My View"),
        },
      ],
    });

    expect(frame.result).toMatchObject({ ok: true });
    expect(
      parse(
        await readFile(
          join(baseDir, ".yarramate/projections/my-view.yaml"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      id: "my-view",
      presentation: { title: "My View", description: "staged" },
    });
    socket.close();
  });

  it("joins the view list a reloading browser is handed", async () => {
    // `resolvedWorkspace` is resolved once at startup and never again, so a
    // projection created mid-session reaches this list only because the commit
    // handler puts it there. The rail and `layout.save` both read it.
    await withWorkspace();
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);

    await sendCommit(socket, {
      viewOperations: [
        {
          op: "write-view",
          path: ".yarramate/projections/joined.yaml",
          projection: projection("joined", "Joined"),
        },
      ],
    });

    expect((await sessionViews(server, cookie)).map((view) => view.id)).toEqual([
      "seeded",
      "joined",
    ]);
    socket.close();
  });

  it("removes a projection a commit staged, and drops it from the view list", async () => {
    await withWorkspace();
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);

    const frame = await sendCommit(socket, {
      viewOperations: [
        { op: "delete-view", path: ".yarramate/projections/seeded.yaml" },
      ],
      sourceDigests: {
        ".yarramate/projections/seeded.yaml": await digestOfFile(
          ".yarramate/projections/seeded.yaml",
        ),
      },
    });

    expect(frame.result).toMatchObject({ ok: true });
    await expect(
      readFile(join(baseDir, ".yarramate/projections/seeded.yaml"), "utf8"),
    ).rejects.toThrow();
    expect(await sessionViews(server, cookie)).toEqual([]);
    socket.close();
  });

  it("lands a view and a subject as one batch, or neither", async () => {
    // The property the whole adapter-level shape exists for: one `writeAll`,
    // so a view and the subjects it shows cannot half arrive.
    await withWorkspace();
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);

    const frame = await sendCommit(socket, {
      operations: [
        {
          op: "update-concept",
          document: ".yarramate/architecture/main.yaml",
          concept: { id: "user", name: "Renamed User" },
        },
      ],
      viewOperations: [
        {
          op: "write-view",
          path: ".yarramate/projections/together.yaml",
          projection: projection("together", "Together"),
        },
      ],
      sourceDigests: {
        ".yarramate/architecture/main.yaml": await digestOfFile(
          ".yarramate/architecture/main.yaml",
        ),
      },
    });

    expect(frame.result).toMatchObject({ ok: true });
    expect(
      await readFile(join(baseDir, ".yarramate/architecture/main.yaml"), "utf8"),
    ).toContain("Renamed User");
    expect(
      await readFile(
        join(baseDir, ".yarramate/projections/together.yaml"),
        "utf8",
      ),
    ).toContain("together");
    socket.close();
  });

  it("refuses the whole batch when a staged view changed on disk, writing nothing", async () => {
    await withWorkspace();
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);

    const stale = await digestOfFile(".yarramate/projections/seeded.yaml");
    // Somebody else edits it after the row was staged.
    await writeFile(
      join(baseDir, ".yarramate/projections/seeded.yaml"),
      seeded.replace("A view that already exists", "Edited elsewhere"),
      "utf8",
    );

    const frame = await sendCommit(socket, {
      operations: [
        {
          op: "update-concept",
          document: ".yarramate/architecture/main.yaml",
          concept: { id: "user", name: "Should Not Land" },
        },
      ],
      viewOperations: [
        {
          op: "write-view",
          path: ".yarramate/projections/seeded.yaml",
          projection: projection("seeded", "Overwritten"),
        },
      ],
      sourceDigests: {
        ".yarramate/architecture/main.yaml": await digestOfFile(
          ".yarramate/architecture/main.yaml",
        ),
        ".yarramate/projections/seeded.yaml": stale,
      },
    });

    expect(frame.result).toMatchObject({ ok: false });
    // Neither half landed: the model document is untouched and the projection
    // still holds what the other writer put there.
    expect(
      await readFile(join(baseDir, ".yarramate/architecture/main.yaml"), "utf8"),
    ).not.toContain("Should Not Land");
    expect(
      await readFile(
        join(baseDir, ".yarramate/projections/seeded.yaml"),
        "utf8",
      ),
    ).toContain("Edited elsewhere");
    socket.close();
  });

  it("refuses a malformed projection at the gate, before the handler sees it", async () => {
    // `viewOperation` in the event schema refs the projection schema, so a
    // document the schema would refuse never reaches the commit path at all -
    // the refusal is a `rejected` frame rather than an `apply-result`.
    await withWorkspace();
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);

    const rejected = nextFrame(socket, "rejected");
    socket.send(
      JSON.stringify({
        type: "changeset.commit",
        lastAcknowledgedSequence: 0,
        payload: {
          operations: [],
          viewOperations: [
            {
              op: "write-view",
              path: ".yarramate/projections/bad.yaml",
              projection: {
                ...projection("bad", "Bad"),
                query: { kinds: "not-a-list" },
              },
            },
          ],
          sourceDigests: {},
        },
      }),
    );

    expect((await rejected).refused).toBe("changeset.commit");
    await expect(
      readFile(join(baseDir, ".yarramate/projections/bad.yaml"), "utf8"),
    ).rejects.toThrow();
    socket.close();
  });

  it("refuses a view saved where the manifest covers no projection", async () => {
    // This repo's own manifest uses `projections/*.yaml`, which reaches no
    // subdirectory - a view written there is a file the workspace never loads,
    // and nothing later would say so (ADR 0043).
    await withWorkspace();
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);

    const frame = await sendCommit(socket, {
      viewOperations: [
        {
          op: "write-view",
          path: ".yarramate/projections/current/nested.yaml",
          projection: projection("nested", "Nested"),
        },
      ],
    });

    expect(frame.result).toMatchObject({ ok: false });
    expect(
      JSON.stringify((frame.result as { readonly diagnostics: unknown })
        .diagnostics),
    ).toContain("YMVS315");
    socket.close();
  });

  it("publishes the projection digests a staged view pins against", async () => {
    await withWorkspace();
    const server = await start();
    const { cookie } = await bootstrap(server);
    const socket = await openBrowserSocket(server, cookie);
    const ready = await nextFrame(socket, "ready");

    const digests = ready.snapshot.model.projectionDigests;
    expect(digests[".yarramate/projections/seeded.yaml"]).toBe(
      await digestOfFile(".yarramate/projections/seeded.yaml"),
    );
    // Kept out of `sourceDigests`, which states what the GRAPH was compiled
    // from and is what `YMVS112` checks.
    expect(
      ready.snapshot.model.sourceDigests[".yarramate/projections/seeded.yaml"],
    ).toBeUndefined();
    socket.close();
  });
});


it("keeps the fixture asset root free of anything the server must not serve", async () => {
  expect(dirname(assetRoot)).toBe(fixtures.replace(/\/$/, ""));
  const page = await readFile(join(assetRoot, "index.html"), "utf8");
  expect(page).not.toMatch(/https?:\/\//);
  expect(page).not.toMatch(/<script(?![^>]*\ssrc=)/);
});

describe("startVisualServer says why a recompile failed (#349)", () => {
  const document = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: user
    kind: businessActor
    name: User
relationships: []
`;
  const manifest = `format: yarramate/workspace/v1
id: recompile-fixture
documents:
  - architecture/main.yaml
profiles: []
projections:
  - projections/*.yaml
adapterMappings: []
evidence: []
`;

  const withWorkspace = async () => {
    await mkdir(join(baseDir, ".yarramate/architecture"), { recursive: true });
    await mkdir(join(baseDir, ".yarramate/projections"), { recursive: true });
    await writeFile(
      join(baseDir, ".yarramate/architecture/main.yaml"),
      document,
      "utf8",
    );
    await writeFile(
      join(baseDir, ".yarramate/projections/seeded.yaml"),
      `format: yarramate/projection/v1
id: seeded
version: "1.0"
query:
  kinds:
    - yarramate/core@0.1#businessActor
presentation:
  title: Seeded
  description: seeded
`,
      "utf8",
    );
    await writeFile(join(baseDir, ".yarramate/workspace.yaml"), manifest, "utf8");
  };

  const sendViewCommit = (socket: WebSocket) => {
    const result = nextFrame(socket, "apply-result");
    socket.send(
      JSON.stringify({
        type: "changeset.commit",
        lastAcknowledgedSequence: 0,
        payload: {
          operations: [],
          viewOperations: [
            {
              op: "write-view",
              path: ".yarramate/projections/added.yaml",
              projection: {
                format: "yarramate/projection/v1",
                id: "added",
                version: "1.0",
                query: { kinds: ["yarramate/core@0.1#businessActor"] },
                presentation: { title: "Added", description: "staged" },
              },
            },
          ],
          sourceDigests: {},
        },
      }),
    );
    return result;
  };

  const enforcesPermissions =
    process.platform !== "win32" && process.getuid?.() !== 0;

  /** Every frame the socket has taken in, for asserting on what did NOT arrive. */
  const settle = async (socket: WebSocket) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return buffered.get(socket) ?? [];
  };

  const diagnosticsFrom = (frames: readonly VisualServerFrame[]) =>
    frames.flatMap((frame) =>
      frame.kind === "response" && frame.response.type === "diagnostic"
        ? (frame.response.payload.diagnostics as readonly {
            readonly code: string;
            readonly message: string;
            readonly path: string;
          }[])
        : [],
    );

  /**
   * A source the manifest resolves and the process cannot read. `globSync`
   * matches it, so the manifest loads; `workspaceSources` then swallows the
   * read error and returns an EMPTY list, and compiling an empty list
   * SUCCEEDS. So the session starts, reports a healthy compile, and draws a
   * workspace holding nothing - rather than saying it could not read a file.
   *
   * `local-host.ts` already refuses the analogous case with YMVS318, "the
   * last good model stays as it is". The session server is the one that
   * degrades silently.
   */
  it.skipIf(!enforcesPermissions)(
    "does not serve an unreadable source as an empty workspace",
    async () => {
      await withWorkspace();
      await chmod(join(baseDir, ".yarramate/architecture/main.yaml"), 0o000);
      const server = await start();
      const { cookie } = await bootstrap(server);
      const socket = await openBrowserSocket(server, cookie);

      const ready = await nextFrame(socket, "ready");
      const diagnostics = diagnosticsFrom(await settle(socket));

      // Either of these alone would be enough to stop the ten-minute
      // diagnosis: do not claim an empty model, and name the file.
      expect(ready.snapshot.model.graph.nodes).not.toEqual([]);
      expect(diagnostics.map((one) => one.code)).toContain("YMVS319");
      expect(
        diagnostics.some((one) =>
          `${one.message} ${one.path}`.includes("architecture/main.yaml"),
        ),
      ).toBe(true);

      await chmod(join(baseDir, ".yarramate/architecture/main.yaml"), 0o600);
      socket.close();
    },
  );

  /**
   * The fault has to clear itself. A `model` frame is what clears the banner
   * in the browser (`model.received` resets `state.diagnostics`), so a
   * recompile that succeeds after one that failed has to broadcast one -
   * and `standingDiagnostics` is dropped with it, so a browser connecting
   * afterwards is not handed a fault that no longer exists.
   */
  it.skipIf(!enforcesPermissions)(
    "stops reporting a fault once the source is readable again",
    async () => {
      await withWorkspace();
      await chmod(join(baseDir, ".yarramate/architecture/main.yaml"), 0o000);
      const server = await start();
      const { cookie } = await bootstrap(server);
      const socket = await openBrowserSocket(server, cookie);

      await nextFrame(socket, "ready");
      expect(diagnosticsFrom(await settle(socket)).length).toBeGreaterThan(0);

      await chmod(join(baseDir, ".yarramate/architecture/main.yaml"), 0o600);
      const model = nextFrame(socket, "model");
      await sendViewCommit(socket);

      expect((await model).model.graph.nodes.map((node) => node.id)).toEqual([
        "user",
      ]);
      socket.close();
    },
  );
});
