import { iconNode, type IconName } from "./icons.ts";

/**
 * Diálogos propios (sustituyen a window.confirm / window.prompt): mismo aspecto que el resto
 * de modales, Enter confirma, Escape o clic fuera cancela y el foco vuelve a donde estaba.
 */

interface DialogOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Acción destructiva: botón de confirmar en rojo. */
  danger?: boolean;
  icon?: IconName;
}

interface PromptOptions extends DialogOptions {
  label?: string;
  initialValue?: string;
  placeholder?: string;
}

function openDialog<T>(
  options: DialogOptions,
  body: HTMLElement | null,
  resolveValue: () => T,
  cancelValue: T,
): Promise<T> {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overlay = document.createElement("div");
    overlay.className = "modal dialog-modal";
    overlay.setAttribute("role", options.danger ? "alertdialog" : "dialog");
    overlay.setAttribute("aria-modal", "true");

    const card = document.createElement("div");
    card.className = `modal-card modal-xs${options.danger ? " is-danger" : ""}`;

    const header = document.createElement("header");
    header.className = "dialog-header";
    const badge = document.createElement("span");
    badge.className = "dialog-icon";
    badge.append(iconNode(options.icon ?? (options.danger ? "alert" : "info"), 18));
    const text = document.createElement("div");
    const title = document.createElement("h3");
    title.id = `dialog-title-${Date.now()}`;
    title.textContent = options.title;
    overlay.setAttribute("aria-labelledby", title.id);
    text.append(title);
    if (options.message) {
      const message = document.createElement("p");
      message.className = "dialog-message";
      message.textContent = options.message;
      text.append(message);
    }
    header.append(badge, text);

    const actions = document.createElement("footer");
    actions.className = "modal-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-secondary";
    cancel.textContent = options.cancelLabel ?? "Cancelar";
    const confirm = document.createElement("button");
    confirm.type = "submit";
    confirm.className = options.danger ? "btn btn-danger" : "btn btn-primary";
    confirm.textContent = options.confirmLabel ?? "Aceptar";
    actions.append(cancel, confirm);

    const form = document.createElement("form");
    form.className = "dialog-form";
    form.append(header);
    if (body) form.append(body);
    form.append(actions);
    card.append(form);
    overlay.append(card);
    document.body.append(overlay);

    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      previousFocus?.focus?.();
      resolve(value);
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      finish(resolveValue());
    });
    cancel.addEventListener("click", () => finish(cancelValue));
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) finish(cancelValue);
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(cancelValue);
      }
    });

    const input = body?.querySelector<HTMLInputElement>("input");
    requestAnimationFrame(() => {
      if (input) {
        input.focus();
        input.select();
      } else {
        (options.danger ? cancel : confirm).focus();
      }
    });
  });
}

/** Confirmación; resuelve true si se acepta. */
export function confirmDialog(options: DialogOptions): Promise<boolean> {
  return openDialog(options, null, () => true, false);
}

/** Pide un texto; resuelve null si se cancela. */
export function promptDialog(options: PromptOptions): Promise<string | null> {
  const field = document.createElement("label");
  field.className = "form-field dialog-field";
  const label = document.createElement("span");
  label.className = "form-label";
  label.textContent = options.label ?? "Nombre";
  const input = document.createElement("input");
  input.className = "input-mono";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.value = options.initialValue ?? "";
  if (options.placeholder) input.placeholder = options.placeholder;
  field.append(label, input);
  return openDialog(options, field, () => input.value, null);
}
