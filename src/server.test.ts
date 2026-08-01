import { describe, expect, it } from "vitest";
import { parseCommand } from "./server.js";

describe("parseCommand", () => {
  it("parses a valid command frame", () => {
    const frame = JSON.stringify({ type: "interrupt", sessionId: "sess_1" });
    expect(parseCommand(frame)).toEqual({ type: "interrupt", sessionId: "sess_1" });
  });

  it("returns null for invalid JSON", () => {
    expect(parseCommand("{not json")).toBeNull();
  });

  it("returns null for JSON without a string type", () => {
    expect(parseCommand(JSON.stringify({ sessionId: "x" }))).toBeNull();
    expect(parseCommand(JSON.stringify("hello"))).toBeNull();
  });
});
