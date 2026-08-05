/**
 * Copia restaurable de la base de staging, antes de tocar nada.
 *
 * Vuelca cada tabla a JSON. Restaurar = volver a insertar esas filas.
 * No modifica nada: solo lee.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import pg from "pg";

const env = Object.fromEntries(
  (await readFile(".env.local", "utf8")).split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const TABLAS = ["clientes", "ciclos", "sesiones", "semanas", "cargos_mensuales",
                "clases_grupo", "confirmaciones", "avisos", "ajustes_mensuales",
                "facturacion_kids_mensual", "idempotencia"];
const copia = {};
for (const tabla of TABLAS) {
  const { rows } = await c.query(`select * from ${tabla}`);
  copia[tabla] = rows;
}
await c.end();

const sello = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
await mkdir(".data/copias", { recursive: true });
const destino = `.data/copias/staging-${sello}.json`;
await writeFile(destino, JSON.stringify(copia, null, 2), "utf8");

console.log(`Copia guardada: ${destino}`);
for (const [tabla, filas] of Object.entries(copia)) console.log(`  ${tabla.padEnd(26)} ${filas.length} filas`);
