/**
 * Comportamiento del armazón de la interfaz (sin estado del proyecto): menús desplegables,
 * pestañas del panel lateral, plegado del panel y botones genéricos de cierre de modales.
 */

const SIDEBAR_STORAGE_KEY = "dbdesigner.sidebar.v1";

function readSidebarCollapsed(): boolean | null {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    return stored === "collapsed" ? true : stored === "open" ? false : null;
  } catch {
    return null;
  }
}

function storeSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "collapsed" : "open");
  } catch {
    // Sin almacenamiento (modo privado): la preferencia dura solo esta sesión.
  }
}

/* ------------------------------- menús ------------------------------- */

let openMenu: HTMLElement | null = null;

function menuParts(menu: HTMLElement) {
  return {
    trigger: menu.querySelector<HTMLButtonElement>("[data-menu-trigger]"),
    panel: menu.querySelector<HTMLElement>(".menu-panel"),
  };
}

function menuItems(menu: HTMLElement): HTMLButtonElement[] {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>(".menu-item:not(:disabled)"));
}

function closeMenu(menu: HTMLElement | null = openMenu, restoreFocus = false): void {
  if (!menu) return;
  const { trigger, panel } = menuParts(menu);
  panel?.setAttribute("hidden", "");
  trigger?.setAttribute("aria-expanded", "false");
  menu.classList.remove("is-open");
  if (openMenu === menu) openMenu = null;
  if (restoreFocus) trigger?.focus();
}

function openMenuPanel(menu: HTMLElement, focusFirst: boolean): void {
  if (openMenu && openMenu !== menu) closeMenu(openMenu);
  const { trigger, panel } = menuParts(menu);
  panel?.removeAttribute("hidden");
  trigger?.setAttribute("aria-expanded", "true");
  menu.classList.add("is-open");
  openMenu = menu;
  if (focusFirst) menuItems(menu)[0]?.focus();
}

function wireMenus(): void {
  document.querySelectorAll<HTMLElement>("[data-menu]").forEach((menu) => {
    const { trigger, panel } = menuParts(menu);
    if (!trigger || !panel) return;
    trigger.setAttribute("aria-expanded", "false");

    trigger.addEventListener("click", () => {
      if (openMenu === menu) closeMenu(menu);
      else openMenuPanel(menu, false);
    });
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        openMenuPanel(menu, true);
      }
    });
    // Elegir una opción cierra el menú (la acción la gestiona el listener propio del botón).
    panel.addEventListener("click", (event) => {
      if ((event.target as Element).closest(".menu-item")) closeMenu(menu);
    });
    panel.addEventListener("keydown", (event) => {
      const items = menuItems(menu);
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        items[(index + delta + items.length) % items.length]?.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(menu, true);
      } else if (event.key === "Tab") {
        closeMenu(menu);
      }
    });
  });

  document.addEventListener("mousedown", (event) => {
    if (openMenu && !openMenu.contains(event.target as Node)) closeMenu(openMenu);
  });
  window.addEventListener("blur", () => closeMenu());
}

/* -------------------------- panel lateral --------------------------- */

function wireSideTabs(): void {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-side-tab]"));
  const select = (name: string, focus = false) => {
    tabs.forEach((tab) => {
      const active = tab.dataset.sideTab === name;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    });
    document.querySelectorAll<HTMLElement>("[data-side-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.sidePanel !== name;
    });
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab.dataset.sideTab ?? "field"));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const next = tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      select(next.dataset.sideTab ?? "field", true);
    });
  });
  select("field");
}

function wireSidebarToggle(): void {
  const shell = document.querySelector<HTMLElement>(".app-shell");
  const toggle = document.querySelector<HTMLButtonElement>("#sidebar-toggle-btn");
  if (!shell || !toggle) return;
  const narrow = window.matchMedia("(max-width: 900px)");

  const apply = (collapsed: boolean) => {
    shell.classList.toggle("is-sidebar-collapsed", collapsed);
    const label = collapsed ? "Mostrar panel" : "Ocultar panel";
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.title = label;
  };

  // En pantallas estrechas el panel flota sobre el lienzo: empieza plegado.
  apply(narrow.matches ? true : (readSidebarCollapsed() ?? false));
  toggle.addEventListener("click", () => {
    const collapsed = !shell.classList.contains("is-sidebar-collapsed");
    apply(collapsed);
    if (!narrow.matches) storeSidebarCollapsed(collapsed);
  });
  narrow.addEventListener("change", (event) => apply(event.matches ? true : (readSidebarCollapsed() ?? false)));
  // En pantallas estrechas el panel tapa el lienzo (y su botón): tocar el lienzo lo pliega.
  document.querySelector(".canvas-area")?.addEventListener("pointerdown", () => {
    if (narrow.matches && !shell.classList.contains("is-sidebar-collapsed")) apply(true);
  });
}

/* ------------------------------ modales ------------------------------ */

/**
 * Los botones `[data-modal-close]` (p. ej. "Cancelar") reutilizan el botón de cierre de la
 * cabecera del modal, para que cada modal ejecute su propia lógica de cierre.
 */
function wireModalCloseButtons(): void {
  document.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLElement>("[data-modal-close]");
    if (!button) return;
    const modal = button.closest<HTMLElement>(".modal");
    const headerClose = modal?.querySelector<HTMLButtonElement>(".modal-header .icon-btn");
    if (headerClose) headerClose.click();
    else modal?.classList.add("hidden");
  });

  // Escape cierra el modal estático visible (el editor de tablas y los diálogos gestionan el suyo).
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (document.querySelector(".dialog-modal")) return;
    const visible = Array.from(document.querySelectorAll<HTMLElement>(".modal:not(.hidden)")).filter(
      (modal) => modal.id !== "table-create-modal",
    );
    const top = visible[visible.length - 1];
    const headerClose = top?.querySelector<HTMLButtonElement>(".modal-header .icon-btn");
    if (!headerClose) return;
    event.preventDefault();
    headerClose.click();
  });
}

export function wireShellControls(): void {
  wireMenus();
  wireSideTabs();
  wireSidebarToggle();
  wireModalCloseButtons();
}
