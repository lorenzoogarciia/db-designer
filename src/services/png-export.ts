import { cardinalityMarkerSize, cardinalityMarkerStroke, RELATION_LINE_WIDTH } from "../diagram/camera.ts";
import type { DiagramController } from "../diagram/diagram-controller.ts";
import { getExportBackgroundColor } from "../lib/theme.ts";
import { computeSafeExportScale, downloadPngFromCanvas } from "../utils/dom.ts";
import { showToast } from "../ui/toast.ts";

/** Margen alrededor del contenido en la imagen exportada (px a escala 1). */
const EXPORT_PADDING = 48;
/** Las etiquetas de relaciones pueden sobresalir del contenido. */
const LABEL_MARGIN = 60;

/** Propiedades que se copian en linea al serializar los SVG (las clases dependen de la hoja de estilos). */
const SVG_STYLE_PROPS = [
  "display",
  "visibility",
  "opacity",
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-opacity",
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
  "dominant-baseline",
  "text-anchor",
] as const;

interface ExportArea {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/**
 * Serializa una capa SVG del diagrama como SVG autonomo del tamano del area exportada,
 * con los estilos calculados en linea (sin depender de clases ni variables CSS).
 */
function serializeLayer(layer: SVGSVGElement, area: ExportArea): string {
  const clone = layer.cloneNode(true) as SVGSVGElement;
  // Los simbolos de cardinalidad estan dimensionados para el zoom actual; en la imagen, los de zoom 1.
  clone.querySelectorAll(".card-marker").forEach((marker) => {
    marker.setAttribute("markerWidth", String(cardinalityMarkerSize(1)));
    marker.setAttribute("markerHeight", String(cardinalityMarkerSize(1)));
  });
  const liveElements = [layer, ...Array.from(layer.querySelectorAll<SVGElement>("*"))];
  const clonedElements = [clone, ...Array.from(clone.querySelectorAll<SVGElement>("*"))];
  liveElements.forEach((live, index) => {
    const target = clonedElements[index];
    if (!target || live === layer) return;
    const computed = getComputedStyle(live);
    const style = SVG_STYLE_PROPS.map((prop) => `${prop}:${computed.getPropertyValue(prop)}`).join(";");
    target.setAttribute("style", style);
    target.removeAttribute("class");
  });

  const layerLeft = parseFloat(layer.style.left) || 0;
  const layerTop = parseFloat(layer.style.top) || 0;
  const content = Array.from(clone.childNodes)
    .map((node) => new XMLSerializer().serializeToString(node))
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${area.width}" height="${area.height}" viewBox="0 0 ${area.width} ${area.height}">` +
    `<g transform="translate(${layerLeft - area.originX}, ${layerTop - area.originY})">${content}</g></svg>`
  );
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo rasterizar el SVG"));
    };
    image.src = url;
  });
}

/**
 * Renderiza el proyecto completo (no solo lo visible) a escala 1 y con todo el detalle,
 * independientemente de la camara actual. La vista del usuario no cambia.
 */
export async function renderDiagramCanvas(diagram: DiagramController): Promise<HTMLCanvasElement | null> {
  const bounds = diagram.getContentBounds();
  if (!bounds) return null;

  const margin = EXPORT_PADDING + LABEL_MARGIN;
  const area: ExportArea = {
    originX: bounds.minX - margin,
    originY: bounds.minY - margin,
    width: Math.ceil(bounds.maxX - bounds.minX + margin * 2),
    height: Math.ceil(bounds.maxY - bounds.minY + margin * 2),
  };

  const viewport = diagram.getDiagramElement();
  const world = diagram.getWorldElement();
  const linesLayer = world.querySelector<SVGSVGElement>(".relation-lines-layer");
  const labelsLayer = world.querySelector<SVGSVGElement>(".relation-labels-layer");

  // Estilos de las relaciones con detalle completo: se fuerza el nivel "full" solo durante la lectura
  // (en la misma tarea, asi que no llega a pintarse).
  const previousLod = world.dataset.lod;
  const previousLabelScale = world.style.getPropertyValue("--label-scale");
  const previousLineWidth = world.style.getPropertyValue("--line-world");
  const previousZoom = world.style.getPropertyValue("--zoom");
  const previousMarkerStroke = world.style.getPropertyValue("--marker-stroke");
  world.dataset.lod = "full";
  world.style.setProperty("--label-scale", "1");
  world.style.setProperty("--line-world", `${RELATION_LINE_WIDTH}px`);
  world.style.setProperty("--zoom", "1");
  world.style.setProperty("--marker-stroke", cardinalityMarkerStroke(1).toFixed(2));
  const linesSvg = linesLayer ? serializeLayer(linesLayer, area) : null;
  const labelsSvg = labelsLayer ? serializeLayer(labelsLayer, area) : null;
  if (previousLod) world.dataset.lod = previousLod;
  world.style.setProperty("--label-scale", previousLabelScale || "1");
  if (previousLineWidth) world.style.setProperty("--line-world", previousLineWidth);
  if (previousZoom) world.style.setProperty("--zoom", previousZoom);
  if (previousMarkerStroke) world.style.setProperty("--marker-stroke", previousMarkerStroke);

  const [linesImage, labelsImage] = await Promise.all([
    linesSvg ? loadSvgImage(linesSvg) : Promise.resolve(null),
    labelsSvg ? loadSvgImage(labelsSvg) : Promise.resolve(null),
  ]);

  // Carga diferida: html2canvas es ~200 KB y solo se necesita al exportar.
  const { default: html2canvas } = await import("html2canvas");
  const initialScale = computeSafeExportScale(area.width, area.height, 2);
  const attemptScales = Array.from(new Set([initialScale, 1, 0.75, 0.5, 0.35].filter((item) => item <= initialScale)));
  let lastError: unknown = undefined;

  for (const scale of attemptScales) {
    try {
      // Solo las tarjetas (HTML): html2canvas no coloca bien SVG desplazados ni transforms anidados.
      const cardsCanvas = await html2canvas(viewport, {
        backgroundColor: null,
        scale,
        useCORS: true,
        x: 0,
        y: 0,
        width: area.width,
        height: area.height,
        windowWidth: area.width,
        windowHeight: area.height,
        scrollX: 0,
        scrollY: 0,
        onclone: (clonedDocument) => {
          const clonedViewport = clonedDocument.getElementById(viewport.id);
          const clonedWorld = clonedViewport?.querySelector<HTMLElement>(".diagram-world");
          if (!clonedViewport || !clonedWorld) return;
          Object.assign(clonedViewport.style, {
            position: "fixed",
            left: "0px",
            top: "0px",
            width: `${area.width}px`,
            height: `${area.height}px`,
            border: "none",
            borderRadius: "0",
            background: "transparent",
          });
          clonedWorld.dataset.lod = "full";
          clonedWorld.style.setProperty("--zoom", "1");
          clonedWorld.style.transform = "none";
          clonedWorld.style.left = `${-area.originX}px`;
          clonedWorld.style.top = `${-area.originY}px`;
          clonedWorld.querySelectorAll<SVGElement>("svg").forEach((layer) => {
            layer.style.display = "none";
          });
          // La leyenda es solo para la vista; se quita del clon (html2canvas ni la analiza).
          clonedViewport.querySelectorAll(".diagram-legend").forEach((legend) => legend.remove());
          clonedWorld.querySelectorAll<HTMLElement>(".table-card").forEach((card) => {
            const match = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\s*\)/.exec(card.style.transform);
            if (!match) return;
            card.style.transform = "none";
            card.style.left = `${match[1]}px`;
            card.style.top = `${match[2]}px`;
          });
        },
      });

      const output = document.createElement("canvas");
      output.width = cardsCanvas.width;
      output.height = cardsCanvas.height;
      const context = output.getContext("2d");
      if (!context) throw new Error("Canvas 2D no disponible");
      context.fillStyle = getExportBackgroundColor();
      context.fillRect(0, 0, output.width, output.height);
      if (linesImage) context.drawImage(linesImage, 0, 0, output.width, output.height);
      context.drawImage(cardsCanvas, 0, 0);
      if (labelsImage) context.drawImage(labelsImage, 0, 0, output.width, output.height);
      return output;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Export failed");
}

export async function exportDiagramAsPng(diagram: DiagramController): Promise<void> {
  try {
    const canvas = await renderDiagramCanvas(diagram);
    if (!canvas) {
      showToast("No hay diagrama para exportar.", "error");
      return;
    }
    downloadPngFromCanvas(canvas);
  } catch {
    showToast("No se pudo exportar la imagen.", "error");
  }
}
