import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { dismissToast, pushToast, subscribeToasts } from "./toasts";

describe("toasts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes and auto-dismisses", () => {
    const seen: number[] = [];
    const unsub = subscribeToasts((t) => seen.push(t.length));
    const id = pushToast({ kind: "info", title: "hi", duration: 1000 });
    expect(seen[seen.length - 1]).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(seen[seen.length - 1]).toBe(0);
    dismissToast(id);
    unsub();
  });

  it("replaces same id", () => {
    let last = 0;
    const unsub = subscribeToasts((t) => {
      last = t.length;
    });
    pushToast({ id: "x", kind: "info", title: "a", duration: 0 });
    pushToast({ id: "x", kind: "success", title: "b", duration: 0 });
    expect(last).toBe(1);
    unsub();
  });
});
