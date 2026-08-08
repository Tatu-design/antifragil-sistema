import { readFile } from "node:fs/promises";
import pg from "pg";
const env = Object.fromEntries(
  (await readFile(".env.local", "utf8")).split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

console.log("COSTE DE ABRIR UNA CONEXIÓN NUEVA\n");
const tiempos = [];
for (let i = 0; i < 4; i += 1) {
  const t = performance.now();
  const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const conectar = performance.now() - t;
  const t2 = performance.now();
  await c.query("select 1");
  const consulta = performance.now() - t2;
  await c.end();
  tiempos.push({ conectar, consulta });
  console.log(`  intento ${i + 1}:  abrir ${conectar.toFixed(0).padStart(4)} ms   +   consultar ${consulta.toFixed(0).padStart(3)} ms`);
}
const media = tiempos.reduce((a, x) => a + x.conectar, 0) / tiempos.length;
console.log(`\n  → abrir la conexión cuesta de media ${media.toFixed(0)} ms, ANTES de la primera consulta.`);

const url = env.DATABASE_URL ?? "";
console.log(`\n  Puerto: ${url.includes(":6543") ? "6543 (pooler en modo transacción)" : url.includes(":5432") ? "5432 (conexión directa)" : "?"}`);
console.log(`  ¿pgbouncer declarado?: ${url.includes("pgbouncer=true") ? "sí" : "NO"}`);
console.log(`  Región del host: ${(url.match(/@([^:]+)/)?.[1] ?? "?")}`);
