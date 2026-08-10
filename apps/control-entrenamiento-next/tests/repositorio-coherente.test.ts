/**
 * Que el repositorio real no pierda por el camino lo que dice guardar.
 *
 * NACE DE UN FALLO CONCRETO (2026-08-10). Al dar de alta a un cliente se
 * elegía profesional, el servicio lo ponía en el objeto… y la consulta de
 * `insert` no nombraba esa columna. El cliente nacía sin profesional y no
 * aparecía en la lista de nadie.
 *
 * Lo grave es que **ninguna prueba lo vio**, y no por descuido: las pruebas
 * corren contra el repositorio de staging, que guarda el objeto entero en un
 * archivo. Allí un campo nuevo sobrevive solo, sin que nadie lo nombre. En
 * PostgreSQL hay que escribir su columna en el `insert` y en el `update`, y si
 * se olvida no falla nada: se pierde en silencio.
 *
 * Y las pruebas contra Supabase se saltan solas cuando hay datos reales
 * —correctísimo—, así que tampoco iban a cazarlo.
 *
 * De ahí esta comprobación, que no necesita base de datos: **lee el código
 * fuente** y exige que toda columna que el repositorio sabe LEER también la
 * sepa ESCRIBIR. Un campo que se lee y no se escribe siempre vale `null`, y
 * eso no es un dato: es un error esperando.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FUENTE = readFileSync(
  path.join(process.cwd(), "src", "repositories", "postgres.ts"),
  "utf8",
);

/** Las columnas que una función de conversión lee de una fila. */
function columnasQueLee(nombreFuncion: string): string[] {
  const inicio = FUENTE.indexOf(`function ${nombreFuncion}(`);
  expect(inicio, `no encuentro la función ${nombreFuncion}`).toBeGreaterThan(-1);
  const fin = FUENTE.indexOf("\n}", inicio);
  const cuerpo = FUENTE.slice(inicio, fin);
  return [...new Set([...cuerpo.matchAll(/\bf\.([a-z_]+)\b/g)].map((m) => m[1]!))];
}

/** Las columnas que aparecen en las escrituras sobre una tabla. */
function columnasQueEscribe(tabla: string): string[] {
  const escrituras = [
    ...FUENTE.matchAll(new RegExp(`insert into ${tabla}\\s*\\(([^)]*)\\)`, "gi")),
    ...FUENTE.matchAll(new RegExp(`update ${tabla} set([\\s\\S]*?)\\bwhere\\b`, "gi")),
  ];
  const columnas = new Set<string>();
  for (const escritura of escrituras) {
    for (const trozo of (escritura[1] ?? "").split(",")) {
      // De «sesiones_completadas = $5» y de « id » sale el nombre a secas.
      const nombre = trozo.split("=")[0]!.trim().replace(/\s+/g, "");
      if (/^[a-z_]+$/.test(nombre)) columnas.add(nombre);
    }
  }
  return [...columnas];
}

describe("el repositorio de PostgreSQL guarda todo lo que lee", () => {
  const casos: Array<{ tabla: string; conversor: string; excusas?: string[] }> = [
    // `creado` y `actualizado` los pone la propia base de datos.
    { tabla: "clientes", conversor: "aCliente" },
    { tabla: "sesiones", conversor: "aSesion" },
  ];

  for (const { tabla, conversor, excusas = [] } of casos) {
    it(`«${tabla}»: ninguna columna que se lee se queda sin escribir`, () => {
      const leidas = columnasQueLee(conversor).filter((c) => !excusas.includes(c));
      const escritas = columnasQueEscribe(tabla);

      expect(leidas.length, `${conversor} no parece leer nada`).toBeGreaterThan(3);

      const olvidadas = leidas.filter((c) => !escritas.includes(c));
      expect(
        olvidadas,
        `«${tabla}» lee estas columnas pero no las escribe nunca, así que siempre valdrán null: ${olvidadas.join(", ")}`,
      ).toEqual([]);
    });
  }

  it("y en concreto el profesional del cliente, que es el que se perdió", () => {
    // Guardia explícita del fallo del 2026-08-10: si alguien vuelve a tocar
    // estas consultas, esta prueba dice exactamente qué se ha roto.
    const escritas = columnasQueEscribe("clientes");
    expect(escritas, "el alta y la edición de un cliente deben guardar `entrenador_id`").toContain(
      "entrenador_id",
    );

    // En las DOS escrituras, no solo en una: crear sin guardarlo deja al
    // cliente huérfano, y editar sin guardarlo se lo quita al editarlo.
    const alta = /insert into clientes\s*\(([^)]*)\)/i.exec(FUENTE)?.[1] ?? "";
    const edicion = /update clientes set([\s\S]*?)\bwhere\b/i.exec(FUENTE)?.[1] ?? "";
    expect(alta, "el `insert` de clientes").toContain("entrenador_id");
    expect(edicion, "el `update` de clientes").toContain("entrenador_id");
  });
});
