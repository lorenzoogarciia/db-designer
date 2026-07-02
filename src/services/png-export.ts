import html2canvas from "html2canvas";
import { getExportBackgroundColor } from "../lib/theme.ts";
import { computeSafeExportScale, downloadPngFromCanvas } from "../utils/dom.ts";

export async function exportDiagramAsPng(diagramElement: HTMLElement): Promise<void> {
  const scene = diagramElement.querySelector<HTMLElement>("#diagram-scene");
  if (!scene) {
    alert("No hay diagrama para exportar.");
    return;
  }
  try {
    const width = Math.max(1, scene.scrollWidth || scene.offsetWidth);
    const height = Math.max(1, scene.scrollHeight || scene.offsetHeight);
    const initialScale = computeSafeExportScale(width, height, 2);
    const attemptScales = Array.from(new Set([initialScale, 1, 0.75, 0.5, 0.35].filter((item) => item <= initialScale)));
    let lastError: unknown = undefined;

    for (const scale of attemptScales) {
      try {
        const canvas = await html2canvas(scene, {
          backgroundColor: getExportBackgroundColor(),
          scale,
          useCORS: true,
          allowTaint: true,
          width,
          height,
          windowWidth: width,
          windowHeight: height,
          scrollX: 0,
          scrollY: 0,
        });
        downloadPngFromCanvas(canvas);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error("Export failed");
  } catch {
    alert("No se pudo exportar la imagen.");
  }
}
