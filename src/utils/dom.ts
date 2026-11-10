export const MAX_EXPORT_SIDE = 8192;
export const MAX_EXPORT_PIXELS = 40_000_000;

export function safeDownloadLink(link: HTMLAnchorElement): void {
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function computeSafeExportScale(width: number, height: number, preferredScale = 2): number {
  const bySide = Math.min(MAX_EXPORT_SIDE / Math.max(width, 1), MAX_EXPORT_SIDE / Math.max(height, 1));
  const byPixels = Math.sqrt(MAX_EXPORT_PIXELS / Math.max(width * height, 1));
  const safeScale = Math.min(preferredScale, bySide, byPixels);
  return Math.max(0.35, Number(safeScale.toFixed(2)));
}

export function downloadPngFromCanvas(canvas: HTMLCanvasElement): void {
  const filename = `db-schema-${Date.now()}.png`;
  const link = document.createElement("a");
  link.download = filename;
  if (canvas.toBlob) {
    canvas.toBlob((blob) => {
      if (!blob) {
        link.href = canvas.toDataURL("image/png");
        safeDownloadLink(link);
        return;
      }
      const url = URL.createObjectURL(blob);
      link.href = url;
      safeDownloadLink(link);
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    }, "image/png");
    return;
  }
  link.href = canvas.toDataURL("image/png");
  safeDownloadLink(link);
}

/**
 * Medidor del ancho (px) de un texto con la fuente de un elemento de referencia, mediante
 * canvas. Si no hay referencia usa la fuente del body.
 */
export function createTextMeasurer(referenceSelector: string, fontWeight = "600"): (text: string, fontPx: number) => number {
  const context = document.createElement("canvas").getContext("2d");
  const reference = document.querySelector(referenceSelector) ?? document.body;
  const family = getComputedStyle(reference).fontFamily || "sans-serif";
  return (text, fontPx) => {
    if (!context) return text.length * fontPx * 0.64;
    context.font = `${fontWeight} ${fontPx}px ${family}`;
    return context.measureText(text).width;
  };
}
