/**
 * A push-driven async iterable. The REPL pushes user turns in as the user
 * types them; the Agent SDK pulls them out via its streaming-input mode.
 * Buffers items pushed before the consumer is ready, so the caller can
 * `push()` a first turn before iteration begins.
 */
export interface InputPump<T> {
  /** Queue an item for the consumer. */
  push(item: T): void;
  /** Signal no more items; the iterable completes once the buffer drains. */
  end(): void;
  /** The async iterable handed to `query({ prompt })`. */
  iterable: AsyncIterable<T>;
}

export function createInputPump<T>(): InputPump<T> {
  const buffer: T[] = [];
  let pending: ((r: IteratorResult<T>) => void) | null = null;
  let ended = false;

  const settle = (value: T | undefined, done: boolean): void => {
    const resolve = pending;
    pending = null;
    resolve?.({ value: value as T, done });
  };

  return {
    push(item: T): void {
      if (ended) return;
      if (pending) settle(item, false);
      else buffer.push(item);
    },
    end(): void {
      ended = true;
      if (pending) settle(undefined, true);
    },
    iterable: {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
          next(): Promise<IteratorResult<T>> {
            if (buffer.length > 0) {
              return Promise.resolve({ value: buffer.shift() as T, done: false });
            }
            if (ended) {
              return Promise.resolve({ value: undefined as never, done: true });
            }
            return new Promise((resolve) => {
              pending = resolve;
            });
          },
        };
      },
    },
  };
}
