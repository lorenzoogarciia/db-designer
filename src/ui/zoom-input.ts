import { parseZoomInput } from "../diagram/camera.ts";
import { formatZoom, type DiagramController } from "../diagram/diagram-controller.ts";

/**
 * Campo de zoom editable: se escribe un porcentaje ("65", "65%", "0,65") y se aplica con Enter
 * o al salir del campo. Escape descarta; las flechas arriba/abajo cambian el zoom un 10 %.
 * El valor se ajusta a los limites permitidos para el proyecto.
 */
export function wireZoomInput(input: HTMLInputElement, diagram: DiagramController): void {
  const showCurrent = () => {
    input.value = formatZoom(diagram.getCamera().zoom);
  };

  const apply = () => {
    const zoom = parseZoomInput(input.value);
    if (zoom !== null) diagram.setZoom(zoom);
    // El zoom se ajusta a los limites del proyecto: mostrar el valor realmente aplicado.
    requestAnimationFrame(showCurrent);
    showCurrent();
  };

  input.addEventListener("focus", () => {
    input.value = input.value.replace("%", "");
    input.select();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      apply();
      input.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      showCurrent();
      input.blur();
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      diagram.zoomBy(event.key === "ArrowUp" ? 1.1 : 1 / 1.1);
      input.value = formatZoom(diagram.getCamera().zoom).replace("%", "");
      input.select();
    }
  });

  input.addEventListener("blur", () => {
    const current = formatZoom(diagram.getCamera().zoom).replace("%", "");
    if (input.value.replace("%", "").trim() !== current) apply();
    else showCurrent();
  });
}
