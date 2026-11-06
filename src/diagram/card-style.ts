/**
 * Posicion de una tarjeta dentro del mundo del canvas. El zoom lo aplica el contenedor
 * del mundo con un unico transform, asi que aqui solo hay traslacion en coordenadas logicas.
 * Se usa translate 2D (no 3D) para que el navegador re-rasterice el texto nitido al cambiar el zoom.
 */
export function tableCardTransform(x: number, y: number): string {
  return `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
}

export function applyTableCardTransform(card: HTMLElement, x: number, y: number): void {
  card.style.transform = tableCardTransform(x, y);
}
