import { describe, expect, it } from "vitest";
import { createInputPump } from "./inputPump.js";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe("createInputPump", () => {
  it("delivers items buffered before iteration starts", async () => {
    const pump = createInputPump<number>();
    pump.push(1);
    pump.push(2);
    pump.end();
    expect(await collect(pump.iterable)).toEqual([1, 2]);
  });

  it("resolves a pending consumer when an item arrives later", async () => {
    const pump = createInputPump<string>();
    const collected = collect(pump.iterable);
    // Consumer is now awaiting; push after a tick.
    await Promise.resolve();
    pump.push("a");
    pump.push("b");
    pump.end();
    expect(await collected).toEqual(["a", "b"]);
  });

  it("completes a pending consumer on end() with no items", async () => {
    const pump = createInputPump<number>();
    const collected = collect(pump.iterable);
    await Promise.resolve();
    pump.end();
    expect(await collected).toEqual([]);
  });

  it("ignores pushes after end()", async () => {
    const pump = createInputPump<number>();
    pump.push(1);
    pump.end();
    pump.push(2);
    expect(await collect(pump.iterable)).toEqual([1]);
  });
});
