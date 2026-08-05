import { readFile } from "node:fs/promises";
import pg from "pg";
const env = Object.fromEntries(
  (await readFile(".env.local", "utf8")).split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows: col } = await c.query(
  "select is_nullable, column_default from information_schema.columns " +
  "where table_name='ciclos' and column_name='pagado'");
console.log("ciclos.pagado →", `nullable=${col[0].is_nullable}`, `default=${col[0].column_default}`);
const { rows: n } = await c.query("select count(*)::int n from ciclos where pagado is null");
console.log("ciclos con NULL:", n[0].n);
const { rows: f } = await c.query(
  "select prosrc like '%v_ciclo.pagado%' as usa_ciclo from pg_proc where proname='firmar_sesion'");
console.log("firmar_sesion conserva el cobro del propio ciclo:", f[0]?.usa_ciclo ? "SÍ" : "NO");
await c.end();
