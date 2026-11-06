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

/** Aviso no bloqueante en la esquina inferior; sustituye a window.alert. */
export function showToast(message: string, kind: ToastKind = "info"): void {
  const toast = document.createElement("div");
  toast.className = `toast toast-${kind}`;
  toast.textContent = message;
  toast.addEventListener("click", () => toast.remove());
  getContainer().append(toast);
  window.setTimeout(() => {
    toast.classList.add("toast-leaving");
    window.setTimeout(() => toast.remove(), 250);
  }, TOAST_DURATION_MS[kind]);
}
