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
