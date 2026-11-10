import { iconNode } from "./icons.ts";

export type ToastKind = "info" | "success" | "error";

const TOAST_DURATION_MS: Record<ToastKind, number> = {
  info: 3200,
  success: 3200,
  error: 5500,
};

let container: HTMLDivElement | null = null;

function getContainer(): HTMLDivElement {
  if (container && document.body.contains(container)) return container;
  container = document.createElement("div");
  container.className = "toast-container";
  container.setAttribute("role", "status");
  container.setAttribute("aria-live", "polite");
  document.body.append(container);
  return container;
}

export interface ToastAction {
  /** Texto del botón (p. ej. «Deshacer»). */
  label: string;
  onAction: () => void;
}

/** Aviso no bloqueante en la esquina inferior; sustituye a window.alert. Admite un botón de acción. */
export function showToast(message: string, kind: ToastKind = "info", action?: ToastAction): void {
  const toast = document.createElement("div");
  toast.className = `toast toast-${kind}`;
  const text = document.createElement("span");
  text.textContent = message;
  toast.append(iconNode(kind === "success" ? "checkCircle" : kind === "error" ? "alert" : "info", 17), text);
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = action.label;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toast.remove();
      action.onAction();
    });
    toast.append(button);
  }
  toast.addEventListener("click", () => toast.remove());
  getContainer().append(toast);
  // Con acción, más tiempo para poder usarla.
  const duration = TOAST_DURATION_MS[kind] + (action ? 4000 : 0);
  window.setTimeout(() => {
    toast.classList.add("toast-leaving");
    window.setTimeout(() => toast.remove(), 250);
  }, duration);
}
