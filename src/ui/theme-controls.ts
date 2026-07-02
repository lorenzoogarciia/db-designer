import {
  applyTheme,
  getActiveTheme,
  getStoredTheme,
  themeToggleIcon,
  themeToggleLabel,
  toggleTheme,
  type AppTheme,
} from "../lib/theme.ts";

export function wireThemeToggles(): void {
  const themeToggleButton = document.querySelector<HTMLButtonElement>("#theme-toggle-btn");
  const themeToggleDiagramButton = document.querySelector<HTMLButtonElement>("#theme-toggle-diagram-btn");

  if (!themeToggleButton || !themeToggleDiagramButton) {
    throw new Error("No se encontraron botones de tema");
  }

  const headerToggle = themeToggleButton;
  const diagramToggle = themeToggleDiagramButton;

  function updateThemeToggleButtons(theme: AppTheme = getActiveTheme()) {
    const label = themeToggleLabel(theme);
    const icon = themeToggleIcon(theme);
    headerToggle.setAttribute("aria-label", label);
    headerToggle.title = label;
    headerToggle.textContent = icon;
    diagramToggle.setAttribute("aria-label", label);
    diagramToggle.title = label;
    diagramToggle.textContent = icon;
  }

  function handleThemeToggle() {
    const nextTheme = toggleTheme();
    updateThemeToggleButtons(nextTheme);
  }

  applyTheme(getStoredTheme());
  updateThemeToggleButtons();
  headerToggle.addEventListener("click", handleThemeToggle);
  diagramToggle.addEventListener("click", handleThemeToggle);
}
