/** Lightweight toast bus for transient UI feedback. */

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  detail?: string;
  /** ms; default 3200 */
  duration?: number;
}

type Listener = (toasts: Toast[]) => void;

let seq = 0;
const toasts: Toast[] = [];
const listeners = new Set<Listener>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit(): void {
  const snapshot = [...toasts];
  for (const l of listeners) l(snapshot);
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener([...toasts]);
  return () => listeners.delete(listener);
}

export function dismissToast(id: string): void {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
  const idx = toasts.findIndex((x) => x.id === id);
  if (idx < 0) return;
  toasts.splice(idx, 1);
  emit();
}

export function pushToast(input: Omit<Toast, "id"> & { id?: string }): string {
  const id = input.id ?? `toast_${++seq}`;
  // Replace same id (useful for reconnect status).
  const existing = toasts.findIndex((t) => t.id === id);
  if (existing >= 0) {
    const old = timers.get(id);
    if (old) clearTimeout(old);
    toasts.splice(existing, 1);
  }
  const toast: Toast = {
    id,
    kind: input.kind,
    title: input.title,
    detail: input.detail,
    duration: input.duration,
  };
  toasts.push(toast);
  if (toasts.length > 5) {
    const dropped = toasts.shift()!;
    const t = timers.get(dropped.id);
    if (t) clearTimeout(t);
    timers.delete(dropped.id);
  }
  emit();
  const ms = input.duration ?? 3200;
  if (ms > 0) {
    timers.set(
      id,
      setTimeout(() => dismissToast(id), ms),
    );
  }
  return id;
}

export function toastInfo(title: string, detail?: string): string {
  return pushToast({ kind: "info", title, detail });
}

export function toastSuccess(title: string, detail?: string): string {
  return pushToast({ kind: "success", title, detail });
}

export function toastError(title: string, detail?: string): string {
  return pushToast({ kind: "error", title, detail, duration: 5000 });
}
