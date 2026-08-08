/**
 * El bono cerrado de Nikki queda marcado como pagado.
 *
 * Solo cambia el estado de COBRO de ese servicio. Como es un ciclo ya cerrado
 * y no el que está en curso, NO se toca `clientes.pendiente_pago`: esa ficha
 * habla del bono de ahora, que sigue sin cobrarse.
 */
import { readFile } from "node:fs/promises";
import pg from "pg";
const env = Object.fromEntries(
  (await readFile(".env.local", "utf8")).split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows } = await c.query("select id, ciclo_actual from clientes where nombre='Nikki'");
const { id, ciclo_actual } = rows[0];

const { rows: antes } = await c.query(
  "select count(*)::int h, coalesce(sum(tarifa),0)::float d from sesiones where to_char(fecha,'YYYY-MM')='2026-07'");

await c.query("update ciclos set pagado = true where cliente_id=$1 and ciclo=1", [id]);

const { rows: ci } = await c.query(
  "select ciclo, pagado from ciclos where cliente_id=$1 order by ciclo", [id]);
const { rows: cl } = await c.query("select pendiente_pago from clientes where id=$1", [id]);
const { rows: despues } = await c.query(
  "select count(*)::int h, coalesce(sum(tarifa),0)::float d from sesiones where to_char(fecha,'YYYY-MM')='2026-07'");

console.log("NIKKI");
for (const x of ci) console.log(`  bono ${x.ciclo}: ${x.pagado ? "PAGADO" : "pendiente de pago"}${x.ciclo === ciclo_actual ? "   <- en curso" : ""}`);
console.log(`  ficha del cliente: ${cl[0].pendiente_pago ? "debe (el bono en curso)" : "al día"}`);
console.log(`\nJulio: ${antes[0].d.toFixed(2)} € / ${antes[0].h} h  ->  ${despues[0].d.toFixed(2)} € / ${despues[0].h} h  (sin cambio, como debe ser)`);
await c.end();
