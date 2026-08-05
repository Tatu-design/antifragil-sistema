import { readFile } from "node:fs/promises";
import pg from "pg";
const env = Object.fromEntries(
  (await readFile(".env.local", "utf8")).split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
await pool.query("select 1");           // calentar

const medir = async (nombre, sql, veces = 10) => {
  const t = performance.now();
  for (let i = 0; i < veces; i += 1) await pool.query(sql);
  const ms = (performance.now() - t) / veces;
  console.log(`  ${nombre.padEnd(42)} ${ms.toFixed(1).padStart(7)} ms`);
  return ms;
};

console.log("LATENCIA POR CONSULTA CONTRA SUPABASE\n");
const trivial = await medir("select 1 (ida y vuelta pura)", "select 1");
await medir("select * from clientes", "select * from clientes");
await medir("select * from ciclos", "select * from ciclos");
await medir("select * from sesiones", "select * from sesiones");

console.log(`\n  → cada consulta cuesta ~${trivial.toFixed(0)} ms SOLO de red.`);
console.log(`  → 25 consultas seguidas = ~${(trivial * 25 / 1000).toFixed(1)} s`);
await pool.end();
