import { writable } from "svelte/store";

/// Severity of a toast. Drives both the colour and the ARIA politeness level.
export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  /// Optional secondary line, used for error details.
  detail?: string;
}

/// How long each kind stays on screen, in milliseconds. Errors persist until
/// dismissed so that a failure is never missed by looking away for a moment.
export const TOAST_TTL: Record<ToastKind, number | null> = {
  success: 3000,
  info: 3000,
  error: null,
};

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export const toasts = writable<Toast[]>([]);

/// Shows a toast and returns its id. Success/info toasts auto-dismiss; errors stay.
export function pushToast(kind: ToastKind, text: string, detail?: string): number {
  const id = nextId++;
  toasts.update((current) => [...current, { id, kind, text, detail }]);

  const ttl = TOAST_TTL[kind];
  if (ttl !== null) {
    timers.set(
      id,
      setTimeout(() => dismissToast(id), ttl)
    );
  }
  return id;
}

/// Removes a toast and clears its pending timer.
export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
  toasts.update((current) => current.filter((toast) => toast.id !== id));
}

/// Clears every toast. Used when a new trove replaces the previous state.
export function clearToasts(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  toasts.set([]);
}
