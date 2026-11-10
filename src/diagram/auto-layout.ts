/**
 * Organización automática de las tablas (botón «Organizar»). Función pura: recibe tablas,
 * relaciones y un medidor de anchos y devuelve la nueva posición de cada tabla.
 *
 * Algoritmo (disposición por capas, tipo Sugiyama, de izquierda a derecha):
 * 1. Componentes conexos del grafo de claves foráneas; las tablas sin relaciones van aparte.
 * 2. Capas: una tabla queda a la derecha de las que referencia (camino más largo, con los
 *    ciclos rotos por DFS) y luego se acerca a sus hijas para acortar líneas.
 * 3. Orden dentro de cada capa por baricentro (varias pasadas) para reducir cruces.
 * 4. Capas demasiado altas se reparten en subcolumnas para mantener una proporción de pantalla.
 * 5. X: columnas separadas según cuántas líneas pasan entre ellas (pasillos para el enrutado).
 * 6. Y: cada tabla busca alinear la fila de su FK con la fila referenciada (líneas rectas),
 *    resuelto por columna con regresión isotónica (PAV) respetando el orden y la separación.
 * 7. Los componentes se empaquetan en estantes con proporción ~16:10.
 *
 * Para que se vea bien a cualquier zoom, si el diagrama encuadrado queda en vista general
 * (donde el nombre se pinta a tamaño fijo en pantalla y la caja crece hasta contenerlo) se
 * recalcula reservando el ancho y el alto que ocupará esa caja. Como la reserva agranda el
 * diagrama y eso aleja el encuadre (y la caja crece aún más en el mundo), se busca el mayor
 * zoom de reserva que el propio encuadre respeta: así, encuadrado, ninguna caja pisa a otra.
 */
import type { Relation, Table } from "../domain/types.ts";
import { FIT_PADDING, LOD_COMPACT_MIN_ZOOM, overviewNameSize } from "./camera.ts";
import { TABLE_ROW_HEIGHT } from "./constants.ts";
import { getTableHeight, type TableWidthResolver } from "./layout.ts";

export interface AutoLayoutOptions {
  getTableWidth: TableWidthResolver;
  /**
   * Ancho en px del nombre pintado en vista general con ese tamaño de letra (en la UI se mide
   * con la fuente real). Sin él se estima por número de caracteres, con holgura.
   */
  measureOverviewName?: OverviewNameMeasurer;
  /** Tamaño del lienzo en px: sirve para prever el zoom de *Ajustar* y la vista general. */
  viewport?: { width: number; height: number };
  /** Esquina superior izquierda del resultado (por defecto 0, 0). */
  origin?: { x: number; y: number };
}

export type LayoutPositions = Map<string, { x: number; y: number }>;
export type OverviewNameMeasurer = (name: string, fontPx: number) => number;

const COLUMN_GAP_MIN = 120;
const COLUMN_GAP_PER_EDGE = 9;
const COLUMN_GAP_MAX = 300;
const ROW_GAP = 64;
const COMPONENT_GAP = 220;
/** Separación vertical entre bandas de columnas y cuánto puede pasarse una banda del ancho buscado. */
const BAND_GAP = 200;
/** Recargo de cada banda extra cuando se alinean filas (preferir la lectura en una sola banda). */
const BAND_PENALTY = 0.35;
/** Alturas de columna que se prueban para dar forma a cada componente. */
const SHAPE_CANDIDATES = 12;
/** Anchos de estante y rejillas de tablas sueltas que se prueban al empaquetar. */
const SHELF_CANDIDATES = 10;
const ISOLATED_COLUMN_OPTIONS = 8;
const ISOLATED_GAP_X = 90;
const ISOLATED_GAP_Y = 70;
/** Proporción ancho:alto buscada sin lienzo conocido; con lienzo, la suya (acotada). */
const DEFAULT_ASPECT = 1.6;
const ORDER_SWEEPS = 16;
const ALIGN_SWEEPS = 14;
/** Ancho medio de carácter (en em) del nombre en vista general, más el relleno de la caja. */
const OVERVIEW_CHAR_EM = 0.64;
const OVERVIEW_BOX_PADDING_PX = 22;
/** Margen en pantalla entre cajas vecinas de la vista general. */
const OVERVIEW_SPACING_PX = 14;
/** Alto de la caja en pantalla: línea de texto (1,2 em), relleno (4 px × 2) y borde (1,5 px × 2). */
const OVERVIEW_LINE_EM = 1.2;
const OVERVIEW_BOX_VERTICAL_PX = 11;
/** Margen vertical en pantalla entre cajas vecinas de la vista general. */
const OVERVIEW_SPACING_Y_PX = 10;
/** Zoom mínimo de reserva que se prueba y pasos de la búsqueda binaria. */
const OVERVIEW_MIN_RESERVE_ZOOM = 0.02;
const OVERVIEW_SEARCH_STEPS = 14;

interface Node {
  table: Table;
  width: number;
  /** Ancho reservado (≥ width): incluye la caja de la vista general si es más ancha. */
  slot: number;
  height: number;
  /** Alto reservado por encima y por debajo de la tabla para la caja de la vista general. */
  padY: number;
}

interface Edge {
  from: string;
  to: string;
  /** Desplazamiento vertical entre las filas ancladas: y(to) + delta = y(from) para alinear. */
  delta: number;
}

interface Block {
  width: number;
  height: number;
  /** Posiciones relativas a la esquina del bloque. */
  positions: LayoutPositions;
}

function compareTables(a: Table, b: Table): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/** Ancho que ocupa en el mundo la caja del nombre en vista general con ese zoom. */
export function overviewBoxWorldWidth(name: string, zoom: number, measure?: OverviewNameMeasurer): number {
  const fontPx = overviewNameSize(zoom);
  const textPx = measure ? measure(name, fontPx) : name.length * fontPx * OVERVIEW_CHAR_EM;
  return (textPx + OVERVIEW_BOX_PADDING_PX + OVERVIEW_SPACING_PX) / zoom;
}

/** Alto que ocupa en el mundo la caja del nombre en vista general (con su margen). */
export function overviewBoxWorldHeight(zoom: number): number {
  const fontPx = overviewNameSize(zoom);
  return (fontPx * OVERVIEW_LINE_EM + OVERVIEW_BOX_VERTICAL_PX + OVERVIEW_SPACING_Y_PX) / zoom;
}

export function computeAutoLayout(tables: Table[], relations: Relation[], options: AutoLayoutOptions): LayoutPositions {
  if (tables.length === 0) return new Map();
  const origin = options.origin ?? { x: 0, y: 0 };

  // Proporción del hueco que deja «Ajustar» (el lienzo menos su margen).
  const aspect = options.viewport
    ? Math.min(
        3,
        Math.max(
          0.8,
          Math.max(1, options.viewport.width - FIT_PADDING * 2) / Math.max(1, options.viewport.height - FIT_PADDING * 2),
        ),
      )
    : DEFAULT_ASPECT;
  let result = layoutOnce(tables, relations, options, null, aspect);
  if (options.viewport) {
    const viewport = options.viewport;
    // Prever el zoom de «Ajustar»: si cae en vista general, reservar el hueco de las cajas.
    // Con huecos reservados para el zoom z, el encuadre resultante debe ser ≥ z: entonces,
    // encuadrado, ninguna caja se monta. Se busca el mayor z que lo cumple (cuanto mayor, más
    // compacto). Si ni el mínimo lo cumple, se usa el que más se acerca.
    if (predictFitZoom(result, viewport) < LOD_COMPACT_MIN_ZOOM) {
      const cache = new Map<number, { block: Block; ratio: number }>();
      const attempt = (zoom: number) => {
        let entry = cache.get(zoom);
        if (!entry) {
          const block = layoutOnce(tables, relations, options, zoom, aspect);
          entry = { block, ratio: predictFitZoom(block, viewport) / zoom };
          cache.set(zoom, entry);
        }
        return entry;
      };
      let low = OVERVIEW_MIN_RESERVE_ZOOM;
      let high = LOD_COMPACT_MIN_ZOOM;
      if (attempt(high).ratio >= 1) {
        result = attempt(high).block;
      } else if (attempt(low).ratio >= 1) {
        for (let step = 0; step < OVERVIEW_SEARCH_STEPS; step += 1) {
          const middle = Math.sqrt(low * high);
          if (attempt(middle).ratio >= 1) low = middle;
          else high = middle;
        }
        result = attempt(low).block;
      } else {
        result = [...cache.values()].reduce((best, entry) => (entry.ratio > best.ratio ? entry : best)).block;
      }
    }
  }

  // La esquina de las tablas (no la de sus huecos reservados) cae en el origen: así organizar
  // dos veces seguidas no mueve nada.
  const points = [...result.positions.values()];
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const positions: LayoutPositions = new Map();
  result.positions.forEach((point, id) => {
    positions.set(id, { x: Math.round(origin.x + point.x - minX), y: Math.round(origin.y + point.y - minY) });
  });
  return positions;
}

function predictFitZoom(block: Block, viewport: { width: number; height: number }): number {
  const availableWidth = Math.max(1, viewport.width - FIT_PADDING * 2);
  const availableHeight = Math.max(1, viewport.height - FIT_PADDING * 2);
  return Math.min(1, availableWidth / Math.max(1, block.width), availableHeight / Math.max(1, block.height));
}

function layoutOnce(
  tables: Table[],
  relations: Relation[],
  options: AutoLayoutOptions,
  overviewZoom: number | null,
  aspect: number,
): Block {
  const nodes = new Map<string, Node>();
  const boxHeight = overviewZoom === null ? 0 : overviewBoxWorldHeight(overviewZoom);
  tables.forEach((table) => {
    const width = options.getTableWidth(table);
    const height = getTableHeight(table);
    const slot =
      overviewZoom === null
        ? width
        : Math.max(width, overviewBoxWorldWidth(table.name, overviewZoom, options.measureOverviewName));
    nodes.set(table.id, { table, width, slot, height, padY: Math.max(0, (boxHeight - height) / 2) });
  });

  const edges: Edge[] = [];
  relations.forEach((relation) => {
    const from = nodes.get(relation.fromTableId);
    const to = nodes.get(relation.toTableId);
    if (!from || !to || from === to) return;
    const fromIndex = Math.max(0, from.table.fields.findIndex((field) => field.id === relation.fromFieldId));
    const toIndex = Math.max(0, to.table.fields.findIndex((field) => field.id === relation.toFieldId));
    edges.push({ from: from.table.id, to: to.table.id, delta: (toIndex - fromIndex) * TABLE_ROW_HEIGHT });
  });

  const adjacency = new Map<string, Set<string>>([...nodes.keys()].map((id) => [id, new Set<string>()]));
  edges.forEach((edge) => {
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  });

  // Componentes conexos, en orden estable.
  const sortedTables = [...tables].sort(compareTables);
  const seen = new Set<string>();
  const components: string[][] = [];
  const isolated: Node[] = [];
  sortedTables.forEach((table) => {
    if (seen.has(table.id)) return;
    if ((adjacency.get(table.id)?.size ?? 0) === 0) {
      seen.add(table.id);
      isolated.push(nodes.get(table.id)!);
      return;
    }
    const component: string[] = [];
    const stack = [table.id];
    seen.add(table.id);
    while (stack.length > 0) {
      const id = stack.pop()!;
      component.push(id);
      adjacency.get(id)?.forEach((next) => {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      });
    }
    components.push(component);
  });

  const blocks = components.map((component) => {
    const ids = new Set(component);
    return layoutComponent(
      component.map((id) => nodes.get(id)!),
      edges.filter((edge) => ids.has(edge.from)),
      aspect,
      overviewZoom === null,
    );
  });
  blocks.sort((a, b) => b.width * b.height - a.width * a.height);
  if (isolated.length === 0) return packBlocks(blocks, aspect);
  // Las tablas sueltas se prueban en rejillas de distinto número de columnas: según el hueco
  // que dejen los componentes conviene una tira, un bloque o una columna.
  const counts = new Set([preferredIsolatedColumns(isolated, aspect)]);
  for (let count = 1; count <= Math.min(isolated.length, ISOLATED_COLUMN_OPTIONS); count += 1) counts.add(count);
  let best: Block | null = null;
  counts.forEach((count) => {
    const packed = packBlocks([...blocks, layoutIsolated(isolated, count)], aspect);
    if (!best || shapeScore(packed, aspect) < shapeScore(best, aspect) - 1e-6) best = packed;
  });
  return best!;
}

/** Cuánto ocupa un bloque escalado a la proporción buscada (menor = encaja mejor). */
function shapeScore(block: Block, aspect: number): number {
  return Math.max(block.width / aspect, block.height);
}

/* --------------------------- un componente --------------------------- */

/**
 * alignRows: alinear la fila de la FK con la referenciada. En vista general las filas no se ven
 * y estirar las columnas para alinearlas haría el diagrama mucho más alto: se apilan compactas.
 */
function layoutComponent(componentNodes: Node[], edges: Edge[], aspect: number, alignRows: boolean): Block {
  const byId = new Map(componentNodes.map((node) => [node.table.id, node]));
  const ids = [...byId.keys()].sort((a, b) => compareTables(byId.get(a)!.table, byId.get(b)!.table));

  // Dependencias (tabla → tablas que referencia) y aristas sin ciclos.
  const deps = new Map<string, string[]>(ids.map((id) => [id, []]));
  edges.forEach((edge) => {
    const list = deps.get(edge.from)!;
    if (!list.includes(edge.to)) list.push(edge.to);
  });
  deps.forEach((list) => list.sort((a, b) => compareTables(byId.get(a)!.table, byId.get(b)!.table)));

  const layer = new Map<string, number>();
  const onStack = new Set<string>();
  const acyclic = new Map<string, string[]>(ids.map((id) => [id, []]));
  const visit = (id: string): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    onStack.add(id);
    let value = 0;
    for (const dep of deps.get(id)!) {
      if (onStack.has(dep)) continue; // arista de retroceso: rompe el ciclo
      value = Math.max(value, visit(dep) + 1);
      acyclic.get(id)!.push(dep);
    }
    onStack.delete(id);
    layer.set(id, value);
    return value;
  };
  ids.forEach((id) => visit(id));
  // Las aristas a nodos ya resueltos durante el ciclo también son válidas si respetan las capas.
  ids.forEach((id) => {
    const list = acyclic.get(id)!;
    deps.get(id)!.forEach((dep) => {
      if (!list.includes(dep) && layer.get(dep)! < layer.get(id)!) list.push(dep);
    });
  });

  // Acercar cada tabla a sus hijas (de derecha a izquierda): acorta las líneas largas.
  const children = new Map<string, string[]>(ids.map((id) => [id, []]));
  acyclic.forEach((list, id) => list.forEach((dep) => children.get(dep)!.push(id)));
  [...ids]
    .sort((a, b) => layer.get(b)! - layer.get(a)!)
    .forEach((id) => {
      const kids = children.get(id)!;
      if (kids.length === 0) return;
      const upper = Math.min(...kids.map((kid) => layer.get(kid)!)) - 1;
      if (upper > layer.get(id)!) layer.set(id, upper);
    });

  // Capas contiguas desde 0.
  const distinct = [...new Set(layer.values())].sort((a, b) => a - b);
  const remap = new Map(distinct.map((value, index) => [value, index]));
  ids.forEach((id) => layer.set(id, remap.get(layer.get(id)!)!));
  const layers: string[][] = distinct.map(() => []);

  // Orden inicial: recorrido en profundidad desde las raíces más conectadas.
  const degree = (id: string) => edges.filter((edge) => edge.from === id || edge.to === id).length;
  const neighbors = new Map<string, string[]>(ids.map((id) => [id, []]));
  edges.forEach((edge) => {
    neighbors.get(edge.from)!.push(edge.to);
    neighbors.get(edge.to)!.push(edge.from);
  });
  const visited = new Set<string>();
  const dfsOrder = (start: string) => {
    const stack = [start];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      layers[layer.get(id)!].push(id);
      [...new Set(neighbors.get(id)!)]
        .filter((next) => !visited.has(next))
        .sort((a, b) => compareTables(byId.get(b)!.table, byId.get(a)!.table))
        .forEach((next) => stack.push(next));
    }
  };
  [...ids].sort((a, b) => layer.get(a)! - layer.get(b)! || degree(b) - degree(a)).forEach(dfsOrder);

  orderByBarycenter(layers, layer, neighbors);

  // Forma del componente: las capas demasiado altas se reparten en subcolumnas y, si las
  // columnas no caben a lo ancho (cadenas de FK largas o cajas de la vista general muy anchas),
  // se parten en bandas consecutivas que se apilan hacia abajo, como un texto que salta de
  // línea (dentro de cada banda se mantiene el orden de izquierda a derecha). Se prueban varias
  // alturas de columna y números de bandas y se elige la forma que mejor encaja en la proporción.
  const maxNodeHeight = Math.max(...componentNodes.map(outerHeight));
  const tallestLayer = Math.max(...layers.map((ordered) => stackHeight(ordered, byId)));
  let best: { columns: string[][]; bands: number[][]; score: number } | null = null;
  for (let step = 0; step < SHAPE_CANDIDATES; step += 1) {
    const ratio = step / (SHAPE_CANDIDATES - 1);
    const maxColumnHeight = maxNodeHeight * Math.pow(Math.max(1, tallestLayer / maxNodeHeight), ratio);
    const columns = splitLayers(layers, byId, maxColumnHeight);
    const widths = columns.map((column) => Math.max(...column.map((id) => byId.get(id)!.slot)));
    const heights = columns.map((column) => stackHeight(column, byId));
    const totalWidth = widths.reduce((sum, width) => sum + width + COLUMN_GAP_MIN, -COLUMN_GAP_MIN);
    const ideal = Math.sqrt(totalWidth / (Math.max(...heights) * aspect));
    const counts = new Set([Math.floor(ideal), Math.ceil(ideal), 1].map((count) => Math.min(columns.length, Math.max(1, count))));
    counts.forEach((count) => {
      const bands = partitionColumns(widths, count);
      const bandWidth = Math.max(...bands.map((band) => band.reduce((sum, index) => sum + widths[index] + COLUMN_GAP_MIN, -COLUMN_GAP_MIN)));
      const bandHeight = bands.reduce((sum, band) => sum + Math.max(...band.map((index) => heights[index])) + BAND_GAP, -BAND_GAP);
      // Con filas alineadas (zoom de trabajo) las bandas cuestan más: se prefiere una sola.
      const penalty = alignRows ? 1 + BAND_PENALTY * (bands.length - 1) : 1;
      const score = Math.max(bandWidth / aspect, bandHeight) * penalty;
      if (!best || score < best.score - 1e-6) best = { columns, bands, score };
    });
  }
  const { columns, bands } = best!;

  const positions: LayoutPositions = new Map();
  let width = 0;
  let cursorY = 0;
  bands.forEach((band) => {
    if (band.length === 0) return;
    const placed = placeColumns(
      band.map((index) => columns[index]),
      byId,
      edges,
      alignRows,
    );
    placed.positions.forEach((point, id) => positions.set(id, { x: point.x, y: point.y + cursorY }));
    width = Math.max(width, placed.width);
    cursorY += placed.height + BAND_GAP;
  });
  return { width, height: cursorY - BAND_GAP, positions };
}

function stackHeight(ids: string[], byId: Map<string, Node>): number {
  return ids.reduce((sum, id) => sum + outerHeight(byId.get(id)!) + ROW_GAP, -ROW_GAP);
}

/** Reparte cada capa más alta que maxColumnHeight en subcolumnas de alto parecido. */
function splitLayers(layers: string[][], byId: Map<string, Node>, maxColumnHeight: number): string[][] {
  const columns: string[][] = [];
  layers.forEach((ordered) => {
    const count = Math.max(1, Math.ceil(stackHeight(ordered, byId) / maxColumnHeight - 1e-9));
    if (count === 1) {
      columns.push(ordered);
      return;
    }
    const split: string[][] = Array.from({ length: count }, () => []);
    const heights = new Array<number>(count).fill(0);
    ordered.forEach((id) => {
      let target = 0;
      for (let index = 1; index < count; index += 1) if (heights[index] < heights[target]) target = index;
      split[target].push(id);
      heights[target] += outerHeight(byId.get(id)!) + ROW_GAP;
    });
    columns.push(...split.filter((column) => column.length > 0));
  });
  return columns;
}

/** Parte las columnas (en orden) en `count` tramos consecutivos de ancho parecido. */
function partitionColumns(widths: number[], count: number): number[][] {
  const total = widths.reduce((sum, width) => sum + width + COLUMN_GAP_MIN, 0);
  const bands: number[][] = [[]];
  let bandWidth = 0;
  widths.forEach((width, index) => {
    const current = bands[bands.length - 1];
    const remainingColumns = widths.length - index;
    const remainingBands = count - bands.length;
    if (
      current.length > 0 &&
      remainingBands > 0 &&
      (bandWidth + width / 2 > total / count || remainingColumns <= remainingBands)
    ) {
      bands.push([]);
      bandWidth = 0;
    }
    bands[bands.length - 1].push(index);
    bandWidth += width + COLUMN_GAP_MIN;
  });
  return bands;
}

/** Coloca columnas consecutivas: X con pasillos según las líneas que los cruzan, Y alineando FK ↔ PK. */
function placeColumns(columns: string[][], byId: Map<string, Node>, allEdges: Edge[], alignRows: boolean): Block {
  const columnOf = new Map<string, number>();
  columns.forEach((column, index) => column.forEach((id) => columnOf.set(id, index)));
  const edges = allEdges.filter((edge) => columnOf.has(edge.from) && columnOf.has(edge.to));
  const crossing = new Array<number>(Math.max(0, columns.length - 1)).fill(0);
  edges.forEach((edge) => {
    const a = columnOf.get(edge.from)!;
    const b = columnOf.get(edge.to)!;
    for (let gap = Math.min(a, b); gap < Math.max(a, b); gap += 1) crossing[gap] += 1;
  });
  const columnWidths = columns.map((column) => Math.max(...column.map((id) => byId.get(id)!.slot)));
  const columnX: number[] = [];
  let cursorX = 0;
  columns.forEach((_, index) => {
    columnX.push(cursorX);
    const gap = index < crossing.length ? clampGap(COLUMN_GAP_MIN + crossing[index] * COLUMN_GAP_PER_EDGE) : 0;
    cursorX += columnWidths[index] + gap;
  });

  const y = alignVertically(columns, byId, edges, columnOf, alignRows ? ALIGN_SWEEPS : 0);

  const positions: LayoutPositions = new Map();
  let minY = Infinity;
  let maxY = -Infinity;
  columns.forEach((column, index) =>
    column.forEach((id) => {
      const node = byId.get(id)!;
      const top = y.get(id)!;
      minY = Math.min(minY, top - node.padY);
      maxY = Math.max(maxY, top + node.height + node.padY);
      positions.set(id, { x: columnX[index] + (columnWidths[index] - node.width) / 2, y: top });
    }),
  );
  positions.forEach((point) => (point.y -= minY));
  const lastColumn = columns.length - 1;
  return { width: columnX[lastColumn] + columnWidths[lastColumn], height: maxY - minY, positions };
}

/** Alto que ocupa una tabla contando la caja de la vista general que se le reserva. */
function outerHeight(node: Node): number {
  return node.height + node.padY * 2;
}

/** Distancia mínima entre el borde superior de una tabla y el de la siguiente de su columna. */
function stackStep(above: Node, below: Node): number {
  return above.height + above.padY + ROW_GAP + below.padY;
}

function clampGap(value: number): number {
  return Math.min(COLUMN_GAP_MAX, Math.max(COLUMN_GAP_MIN, value));
}

/** Heurística del baricentro: ordena cada capa según la posición media de sus vecinas. */
function orderByBarycenter(layers: string[][], layer: Map<string, number>, neighbors: Map<string, string[]>): void {
  const position = new Map<string, number>();
  const refresh = (ordered: string[]) =>
    ordered.forEach((id, index) => position.set(id, (index + 0.5) / ordered.length));
  layers.forEach(refresh);

  for (let sweep = 0; sweep < ORDER_SWEEPS; sweep += 1) {
    const forward = sweep % 2 === 0;
    const sequence = forward ? layers.map((_, index) => index) : layers.map((_, index) => layers.length - 1 - index);
    sequence.forEach((index) => {
      const ordered = layers[index];
      const score = new Map<string, number>();
      ordered.forEach((id) => {
        let sum = 0;
        let weight = 0;
        neighbors.get(id)!.forEach((other) => {
          const distance = layer.get(other)! - index;
          if (distance === 0 || (forward ? distance > 0 : distance < 0)) return;
          const w = 1 / Math.abs(distance);
          sum += position.get(other)! * w;
          weight += w;
        });
        score.set(id, weight > 0 ? sum / weight : position.get(id)!);
      });
      ordered.sort((a, b) => score.get(a)! - score.get(b)! || position.get(a)! - position.get(b)!);
      refresh(ordered);
    });
  }
}

/**
 * Coordenada vertical de cada tabla. Cada tabla quiere que su fila FK quede a la altura de la
 * fila referenciada (y viceversa); dentro de la columna se respeta el orden y la separación
 * con la solución de mínimos cuadrados (regresión isotónica por PAV).
 */
function alignVertically(
  columns: string[][],
  byId: Map<string, Node>,
  edges: Edge[],
  columnOf: Map<string, number>,
  sweeps: number,
): Map<string, number> {
  const y = new Map<string, number>();
  columns.forEach((column) => {
    const total = column.reduce((sum, id) => sum + outerHeight(byId.get(id)!) + ROW_GAP, -ROW_GAP);
    let cursor = -total / 2 + byId.get(column[0])!.padY;
    column.forEach((id, index) => {
      y.set(id, cursor);
      if (index + 1 < column.length) cursor += stackStep(byId.get(id)!, byId.get(column[index + 1])!);
    });
  });

  const wishes = new Map<string, Array<{ other: string; delta: number }>>([...byId.keys()].map((id) => [id, []]));
  edges.forEach((edge) => {
    wishes.get(edge.from)!.push({ other: edge.to, delta: edge.delta });
    wishes.get(edge.to)!.push({ other: edge.from, delta: -edge.delta });
  });

  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    const forward = sweep % 2 === 0;
    const order = columns.map((_, index) => (forward ? index : columns.length - 1 - index));
    order.forEach((columnIndex) => {
      const column = columns[columnIndex];
      const desired: number[] = [];
      const weights: number[] = [];
      column.forEach((id) => {
        let sum = 0;
        let weight = 0;
        wishes.get(id)!.forEach(({ other, delta }) => {
          const distance = Math.abs(columnOf.get(other)! - columnIndex);
          if (distance === 0) return;
          const w = 1 / distance;
          sum += (y.get(other)! + delta) * w;
          weight += w;
        });
        desired.push(weight > 0 ? sum / weight : y.get(id)!);
        weights.push(weight > 0 ? weight : 0.05);
      });
      const offsets: number[] = [];
      let offset = 0;
      column.forEach((id, index) => {
        offsets.push(offset);
        if (index + 1 < column.length) offset += stackStep(byId.get(id)!, byId.get(column[index + 1])!);
      });
      const solved = isotonic(
        desired.map((value, index) => value - offsets[index]),
        weights,
      );
      column.forEach((id, index) => y.set(id, solved[index] + offsets[index]));
    });
  }
  return y;
}

/** Regresión isotónica ponderada (no decreciente) por el algoritmo PAV. */
export function isotonic(values: number[], weights: number[]): number[] {
  const blocks: Array<{ value: number; weight: number; count: number }> = [];
  values.forEach((value, index) => {
    blocks.push({ value, weight: weights[index], count: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].value > blocks[blocks.length - 1].value) {
      const last = blocks.pop()!;
      const prev = blocks[blocks.length - 1];
      const weight = prev.weight + last.weight;
      prev.value = (prev.value * prev.weight + last.value * last.weight) / weight;
      prev.weight = weight;
      prev.count += last.count;
    }
  });
  const result: number[] = [];
  blocks.forEach((block) => {
    for (let index = 0; index < block.count; index += 1) result.push(block.value);
  });
  return result;
}

/* ------------------- tablas sueltas y empaquetado ------------------- */

/** Tablas sin relaciones: rejilla alfabética, columnas del ancho de su tabla más ancha. */
function preferredIsolatedColumns(isolated: Node[], aspect: number): number {
  const averageWidth = isolated.reduce((sum, node) => sum + node.slot + ISOLATED_GAP_X, 0) / isolated.length;
  const averageHeight = isolated.reduce((sum, node) => sum + outerHeight(node) + ISOLATED_GAP_Y, 0) / isolated.length;
  return Math.max(1, Math.min(isolated.length, Math.round(Math.sqrt((isolated.length * averageHeight * aspect) / averageWidth))));
}

function layoutIsolated(isolated: Node[], columns: number): Block {
  const sorted = [...isolated].sort((a, b) => compareTables(a.table, b.table));
  const columnCount = Math.max(1, Math.min(sorted.length, columns));
  const rows = Math.ceil(sorted.length / columnCount);
  const columnWidths = new Array<number>(columnCount).fill(0);
  const rowHeights = new Array<number>(rows).fill(0);
  sorted.forEach((node, index) => {
    columnWidths[index % columnCount] = Math.max(columnWidths[index % columnCount], node.slot);
    rowHeights[Math.floor(index / columnCount)] = Math.max(rowHeights[Math.floor(index / columnCount)], outerHeight(node));
  });
  const columnX = columnWidths.map((_, index) => columnWidths.slice(0, index).reduce((sum, width) => sum + width + ISOLATED_GAP_X, 0));
  const rowY = rowHeights.map((_, index) => rowHeights.slice(0, index).reduce((sum, height) => sum + height + ISOLATED_GAP_Y, 0));
  const positions: LayoutPositions = new Map();
  sorted.forEach((node, index) => {
    const column = index % columnCount;
    positions.set(node.table.id, {
      x: columnX[column] + (columnWidths[column] - node.width) / 2,
      y: rowY[Math.floor(index / columnCount)] + node.padY,
    });
  });
  return {
    width: columnX[columnCount - 1] + columnWidths[columnCount - 1],
    height: rowY[rows - 1] + rowHeights[rows - 1],
    positions,
  };
}

/** Empaquetado en estantes buscando una proporción de pantalla. */
function packBlocks(blocks: Block[], aspect: number): Block {
  if (blocks.length === 1) return blocks[0];
  const totalArea = blocks.reduce((sum, block) => sum + (block.width + COMPONENT_GAP) * (block.height + COMPONENT_GAP), 0);
  const widest = Math.max(...blocks.map((block) => block.width));
  const allInRow = blocks.reduce((sum, block) => sum + block.width + COMPONENT_GAP, -COMPONENT_GAP);
  // Ancho de estante: el de la proporción por área y otros entre el bloque más ancho y todos en fila.
  const candidates = [Math.max(widest, Math.sqrt(totalArea * aspect))];
  for (let step = 0; step < SHELF_CANDIDATES; step += 1) {
    candidates.push(widest * Math.pow(Math.max(1, allInRow / widest), step / (SHELF_CANDIDATES - 1)));
  }
  let best: Block | null = null;
  candidates.forEach((shelfWidth) => {
    const packed = packShelves(blocks, shelfWidth);
    if (!best || shapeScore(packed, aspect) < shapeScore(best, aspect) - 1e-6) best = packed;
  });
  return best!;
}

/** Empaquetado en estantes de un ancho dado. */
function packShelves(blocks: Block[], shelfWidth: number): Block {
  const positions: LayoutPositions = new Map();
  let x = 0;
  let y = 0;
  let shelfHeight = 0;
  let width = 0;
  blocks.forEach((block) => {
    if (x > 0 && x + block.width > shelfWidth + 1e-6) {
      x = 0;
      y += shelfHeight + COMPONENT_GAP;
      shelfHeight = 0;
    }
    block.positions.forEach((point, id) => positions.set(id, { x: x + point.x, y: y + point.y }));
    width = Math.max(width, x + block.width);
    shelfHeight = Math.max(shelfHeight, block.height);
    x += block.width + COMPONENT_GAP;
  });
  return { width, height: y + shelfHeight, positions };
}
