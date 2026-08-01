import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentSession } from "../agent/index.js";
import type { EngineEvent } from "./protocol.js";
import { SessionManager, type CreateSessionFn } from "./manager.js";

/** A controllable fake session that yields a fixed script, then completes. */
function makeFake(script: AgentEvent[]): {
  session: AgentSession;
  sent: string[];
  isClosed: () => boolean;
} {
  const sent: string[] = [];
  let closed = false;
  const session: AgentSession = {
    send: (text) => {
      sent.push(text);
    },
    close: () => {
      closed = true;
    },
    interrupt: async () => {},
    events: (async function* () {
      for (const event of script) yield event;
    })(),
  };
  return { session, sent, isClosed: () => closed };
}

describe("SessionManager", () => {
  it("emits session_created, tagged agent events, then session_closed", async () => {
    const events: EngineEvent[] = [];
    let resolve!: () => void;
    const finished = new Promise<void>((r) => (resolve = r));
    const script: AgentEvent[] = [
      { type: "text", text: "hi" },
      { type: "result", ok: true, durationMs: 1000, costUsd: 0.01 },
    ];
    const createSession: CreateSessionFn = () => makeFake(script).session;
    const mgr = new SessionManager({
      createSession,
      onEvent: (e) => {
        events.push(e);
        if (e.type === "session_closed") resolve();
      },
    });

    mgr.handleCommand({
      type: "create_session",
      requestId: "r1",
      provider: "fake",
      model: "m",
      cwd: "/",
    });
    await finished;

    expect(events[0]).toEqual({
      type: "session_created",
      requestId: "r1",
      sessionId: expect.any(String),
    });
    const sessionId = (events[0] as { sessionId: string }).sessionId;
    expect(events).toContainEqual({
      type: "agent_event",
      sessionId,
      event: { type: "text", text: "hi" },
    });
    expect(events.at(-1)).toEqual({ type: "session_closed", sessionId });
  });

  it("routes send_message to the correct session", () => {
    const fake = makeFake([]);
    const mgr = new SessionManager({
      createSession: () => fake.session,
      onEvent: () => {},
    });
    const sessionId = mgr.create("fake", { model: "m", cwd: "/" });
    mgr.handleCommand({ type: "send_message", sessionId, text: "hello" });
    expect(fake.sent).toEqual(["hello"]);
  });

  it("closes a session on close_session", () => {
    const fake = makeFake([]);
    const mgr = new SessionManager({
      createSession: () => fake.session,
      onEvent: () => {},
    });
    const sessionId = mgr.create("fake", { model: "m", cwd: "/" });
    mgr.handleCommand({ type: "close_session", sessionId });
    expect(fake.isClosed()).toBe(true);
  });

  it("emits an error for a command against an unknown session", () => {
    const events: EngineEvent[] = [];
    const mgr = new SessionManager({
      createSession: () => makeFake([]).session,
      onEvent: (e) => events.push(e),
    });
    mgr.handleCommand({ type: "send_message", sessionId: "nope", text: "x" });
    expect(events).toContainEqual({
      type: "error",
      message: expect.stringContaining("nope"),
      sessionId: "nope",
      requestId: undefined,
    });
  });
});
