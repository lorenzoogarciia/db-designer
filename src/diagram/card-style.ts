import { CANVAS_GUTTER } from "./constants.ts";

/** Compositor-friendly card placement: translate + scale, no left/top layout thrash. */
export function tableCardTransform(x: number, y: number, zoom: number): string {
  const px = (x + CANVAS_GUTTER) * zoom;
  const py = (y + CANVAS_GUTTER) * zoom;
  return `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0) scale(${zoom})`;
}

export function applyTableCardTransform(card: HTMLElement, x: number, y: number, zoom: number): void {
  card.style.transform = tableCardTransform(x, y, zoom);
}
