import { describe, expect, it } from "vitest";
import type { Field, Relation, Table } from "../domain/types.ts";
import { computeAutoLayout, isotonic, overviewBoxWorldWidth } from "./auto-layout.ts";
import { fitZoom, overviewNameSize } from "./camera.ts";
import { TABLE_HEADER_HEIGHT, TABLE_ROW_HEIGHT } from "./constants.ts";
import { getTableHeight } from "./layout.ts";

function field(id: string, name = id): Field {
  return { id, name, type: "integer", nullable: false, isPrimary: false, isUnique: false, autoIncrement: false, isIndexed: false };
}

function table(id: string, fieldNames: string[] = ["id"]): Table {
  return { id, name: id, x: 0, y: 0, fields: fieldNames.map((name) => field(`${id}.${name}`, name)) };
}

function fk(from: Table, fromField: string, to: Table, toField = "id"): Relation {
  return {
    id: `${from.id}.${fromField}->${to.id}.${toField}`,
    fromTableId: from.id,
    fromFieldId: `${from.id}.${fromField}`,
    toTableId: to.id,
    toFieldId: `${to.id}.${toField}`,
    kind: "1:N",
    onDelete: "NO ACTION",
    onUpdate: "NO ACTION",
  };
}

const width = (_table?: Table) => 300;

function rowCenter(t: Table, position: { y: number }, fieldName: string): number {
  const index = t.fields.findIndex((f) => f.name === fieldName);
  return position.y + TABLE_HEADER_HEIGHT + index * TABLE_ROW_HEIGHT + TABLE_ROW_HEIGHT / 2;
}

function expectNoOverlap(tables: Table[], positions: Map<string, { x: number; y: number }>, getWidth: (t: Table) => number = width, gap = 40) {
  for (let i = 0; i < tables.length; i += 1) {
    for (let j = i + 1; j < tables.length; j += 1) {
      const a = positions.get(tables[i].id)!;
      const b = positions.get(tables[j].id)!;
      const overlap =
        a.x < b.x + getWidth(tables[j]) + gap &&
        a.x + getWidth(tables[i]) + gap > b.x &&
        a.y < b.y + getTableHeight(tables[j]) + gap &&
        a.y + getTableHeight(tables[i]) + gap > b.y;
      expect(overlap, `${tables[i].id} / ${tables[j].id}`).toBe(false);
    }
  }
}

describe("isotonic", () => {
  it("devuelve una secuencia no decreciente de mínimos cuadrados", () => {
    expect(isotonic([1, 3, 2, 4], [1, 1, 1, 1])).toEqual([1, 2.5, 2.5, 4]);
    expect(isotonic([5, 1], [3, 1])).toEqual([4, 4]);
  });
});

describe("computeAutoLayout", () => {
  it("devuelve una posición por tabla y empieza en el origen indicado", () => {
    const users = table("users");
    const orders = table("orders", ["id", "user_id"]);
    const positions = computeAutoLayout([users, orders], [fk(orders, "user_id", users)], {
      getTableWidth: width,
      origin: { x: 100, y: 50 },
    });
    expect(positions.size).toBe(2);
    expect(Math.min(...[...positions.values()].map((p) => p.x))).toBe(100);
    expect(Math.min(...[...positions.values()].map((p) => p.y))).toBe(50);
  });

  it("organizar dos veces seguidas no mueve nada (también con huecos reservados)", () => {
    const tables = [
      table("a"),
      table("nombre_de_tabla_bastante_largo", ["id", "a_id"]),
      table("b", ["id", "a_id", "x"]),
      ...Array.from({ length: 80 }, (_, index) => table(`suelta_${index}`)),
    ];
    const relations = [fk(tables[1], "a_id", tables[0]), fk(tables[2], "a_id", tables[0])];
    const viewport = { width: 1200, height: 700 };
    const getWidth = (t: Table) => (t.name.length > 10 ? 320 : 260);
    const first = computeAutoLayout(tables, relations, { getTableWidth: getWidth, viewport, origin: { x: 37, y: -12 } });
    const moved = tables.map((t) => ({ ...t, ...first.get(t.id)! }));
    const minX = Math.min(...moved.map((t) => t.x));
    const minY = Math.min(...moved.map((t) => t.y));
    expect([minX, minY]).toEqual([37, -12]);
    const second = computeAutoLayout(moved, relations, { getTableWidth: getWidth, viewport, origin: { x: minX, y: minY } });
    expect([...second.entries()]).toEqual([...first.entries()]);
  });

  it("coloca las tablas referenciadas a la izquierda y alinea la fila FK con la PK", () => {
    const users = table("users", ["id", "name"]);
    const orders = table("orders", ["id", "total", "user_id"]);
    const items = table("items", ["id", "order_id"]);
    const positions = computeAutoLayout(
      [items, orders, users],
      [fk(orders, "user_id", users), fk(items, "order_id", orders)],
      { getTableWidth: width },
    );
    const u = positions.get("users")!;
    const o = positions.get("orders")!;
    const i = positions.get("items")!;
    expect(u.x).toBeLessThan(o.x);
    expect(o.x).toBeLessThan(i.x);
    expect(rowCenter(orders, o, "user_id")).toBe(rowCenter(users, u, "id"));
    expect(rowCenter(items, i, "order_id")).toBe(rowCenter(orders, o, "id"));
  });

  it("separa las tablas sin relaciones y nunca solapa", () => {
    const tables = [table("a"), table("b", ["id", "a_id"]), table("solo1"), table("solo2", ["id", "x", "y"])];
    const positions = computeAutoLayout(tables, [fk(tables[1], "a_id", tables[0])], { getTableWidth: width });
    expectNoOverlap(tables, positions);
  });

  it("soporta ciclos y autorrelaciones", () => {
    const a = table("a", ["id", "b_id", "parent_id"]);
    const b = table("b", ["id", "a_id"]);
    const positions = computeAutoLayout(
      [a, b],
      [fk(a, "b_id", b), fk(b, "a_id", a), fk(a, "parent_id", a)],
      { getTableWidth: width },
    );
    expect(positions.size).toBe(2);
    expectNoOverlap([a, b], positions);
  });

  it("es determinista y no solapa en un proyecto grande", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const tables: Table[] = [];
    const relations: Relation[] = [];
    for (let index = 0; index < 150; index += 1) {
      const fieldCount = 2 + Math.floor(random() * 10);
      const names = ["id", ...Array.from({ length: fieldCount }, (_, k) => `f${k}`)];
      const created = table(`t${index}`, names);
      tables.push(created);
      if (index > 0 && random() < 0.85) {
        const links = 1 + Math.floor(random() * 3);
        for (let k = 0; k < links; k += 1) {
          const target = tables[Math.floor(random() * index)];
          relations.push(fk(created, `f${k % fieldCount}`, target));
        }
      }
    }
    const getWidth = (t: Table) => 260 + (t.fields.length % 4) * 40;
    const started = performance.now();
    const first = computeAutoLayout(tables, relations, { getTableWidth: getWidth, viewport: { width: 1400, height: 800 } });
    const elapsed = performance.now() - started;
    const second = computeAutoLayout(tables, relations, { getTableWidth: getWidth, viewport: { width: 1400, height: 800 } });
    expect([...first.entries()]).toEqual([...second.entries()]);
    expectNoOverlap(tables, first, getWidth);
    expect(elapsed).toBeLessThan(1500);
    // Proporción razonable (ni una tira horizontal ni una vertical).
    const xs = tables.map((t) => first.get(t.id)!.x);
    const ys = tables.map((t) => first.get(t.id)!.y);
    const ratio = (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys));
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(5);
  });

  it("en vista general reserva el ancho del nombre si cuesta poco zoom (las cajas no se montan)", () => {
    const tables = Array.from({ length: 200 }, (_, index) => table(`clientes_${index}`));
    const viewport = { width: 1600, height: 900 };
    const positions = computeAutoLayout(tables, [], { getTableWidth: width, viewport });
    const xs = tables.map((t) => positions.get(t.id)!.x);
    const ys = tables.map((t) => positions.get(t.id)!.y + getTableHeight(t));
    const bounds = { w: Math.max(...xs) + 300 - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys.map((v, i) => v - getTableHeight(tables[i]))) };
    const zoom = Math.min((viewport.width - 96) / bounds.w, (viewport.height - 96) / bounds.h, 1);
    expect(zoom).toBeLessThan(0.33);
    const box = overviewBoxWorldWidth(tables[0].name, zoom);
    // Ninguna pareja de la misma fila queda más cerca que la caja del nombre.
    const centers = tables.map((t) => ({ x: positions.get(t.id)!.x + 150, y: positions.get(t.id)!.y }));
    centers.forEach((a, i) =>
      centers.forEach((b, j) => {
        if (i < j && a.y === b.y) expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(box * 0.95);
      }),
    );
  });

  it("encuadrado en vista general, ninguna caja de nombre se monta sobre otra (ni en alto ni en ancho)", () => {
    // Proyecto denso con cadenas de FK largas (muchas capas) y nombres largos, como uno real.
    let seed = 3;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const tables: Table[] = [];
    const relations: Relation[] = [];
    for (let index = 0; index < 70; index += 1) {
      const fieldCount = 2 + Math.floor(random() * 8);
      const created = table(`modulo_entidad_${"x".repeat(Math.floor(random() * 14))}_${index}`, [
        "id",
        ...Array.from({ length: fieldCount }, (_, k) => `f${k}`),
      ]);
      tables.push(created);
      // Cada tabla referencia a alguna de las últimas: cadenas de muchas capas.
      if (index > 0 && random() < 0.9) {
        const target = tables[Math.max(0, index - 1 - Math.floor(random() * 4))];
        relations.push(fk(created, "f0", target));
        if (random() < 0.5) relations.push(fk(created, "f1", tables[Math.floor(random() * index)]));
      }
    }
    const getWidth = (t: Table) => 260 + t.name.length * 3;
    const measure = (name: string, fontPx: number) => name.length * fontPx * 0.5;
    for (const viewport of [
      { width: 1276, height: 808 },
      { width: 1500, height: 700 },
      { width: 1900, height: 950 },
    ]) {
      const positions = computeAutoLayout(tables, relations, { getTableWidth: getWidth, viewport, measureOverviewName: measure });
      const rects = tables.map((t) => ({ t, ...positions.get(t.id)!, w: getWidth(t), h: getTableHeight(t) }));
      const minX = Math.min(...rects.map((r) => r.x));
      const minY = Math.min(...rects.map((r) => r.y));
      const zoom = Math.min(
        1,
        fitZoom(
          { minX, minY, maxX: Math.max(...rects.map((r) => r.x + r.w)), maxY: Math.max(...rects.map((r) => r.y + r.h)) },
          viewport.width,
          viewport.height,
        ),
      );
      expect(zoom).toBeLessThan(0.33);
      // Al menos un zoom razonable: la reserva no puede dejarlo todo diminuto.
      expect(zoom).toBeGreaterThan(0.05);
      // Caja pintada: nombre + relleno (8 px) + borde (1,5 px), centrada sobre la tabla.
      const fontPx = overviewNameSize(zoom);
      const boxes = rects.map((r) => {
        const w = Math.max(r.w, (measure(r.t.name, fontPx) + 16 + 3) / zoom);
        const h = Math.max(r.h, (fontPx * 1.2 + 8 + 3) / zoom);
        return { id: r.t.id, x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h };
      });
      boxes.forEach((a, i) =>
        boxes.slice(i + 1).forEach((b) => {
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap, `${a.id} / ${b.id} (${viewport.width}×${viewport.height})`).toBe(false);
        }),
      );
    }
  });
});
