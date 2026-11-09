/**
 * Espera a las tipografías de la interfaz antes del primer render del diagrama: las tarjetas
 * miden y fijan su ancho al renderizar, y medir con la fuente de reserva dejaría anchos
 * incorrectos. Sin conexión (o si tardan) se sigue con las del sistema tras un tiempo máximo.
 */
const UI_FONTS = [
  '600 15px "IBM Plex Sans"',
  '400 13px "IBM Plex Sans"',
  '550 13px "JetBrains Mono"',
  '700 10px "JetBrains Mono"',
];

export function whenUiFontsReady(timeoutMs = 2500): Promise<void> {
  if (!("fonts" in document)) return Promise.resolve();
  const loads = Promise.all(UI_FONTS.map((font) => document.fonts.load(font).catch(() => []))).then(() => undefined);
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs));
  return Promise.race([loads, timeout]);
}
