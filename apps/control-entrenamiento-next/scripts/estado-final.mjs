import { readFile } from "node:fs/promises";
import pg from "pg";
const env = Object.fromEntries(
  (await readFile(".env.local", "utf8")).split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

console.log("ECONOMÍA POR MES (sesiones + cuotas)\n");
const { rows: m } = await c.query(
  "select to_char(fecha,'YYYY-MM') mes, count(*)::int h, coalesce(sum(tarifa),0)::float d from sesiones group by 1 order by 1 desc");
const { rows: q } = await c.query("select anio, mes, sum(importe)::float cuota from cargos_mensuales group by 1,2");
for (const x of m) {
  const cuota = q.find((y) => `${y.anio}-${String(y.mes).padStart(2,"0")}` === x.mes)?.cuota ?? 0;
  const total = x.d + cuota;
  console.log(`  ${x.mes}:  ${total.toFixed(2).padStart(8)} €   ${String(x.h).padStart(2)} h   ` +
    `${(total / x.h).toFixed(2).padStart(6)} €/h    (sesiones ${x.d.toFixed(2)} € + cuotas ${cuota.toFixed(2)} €)`);
}

console.log("\nSERVICIOS DE CADA CLIENTE\n");
const { rows: r } = await c.query(`
  select cl.nombre, cl.ciclo_actual, ci.ciclo, ci.modalidad, ci.cuota_mensual, ci.tarifa,
         ci.sesiones_totales, ci.sesiones_referencia, ci.pagado,
         (select count(*)::int from sesiones s where s.cliente_id=ci.cliente_id and s.ciclo=ci.ciclo) n
    from ciclos ci join clientes cl on cl.id=ci.cliente_id order by cl.nombre, ci.ciclo`);
let actual = "";
for (const x of r) {
  if (x.nombre !== actual) { actual = x.nombre; console.log(`  ${actual}`); }
  const cond = x.modalidad === "mensualidad"
    ? `cuota ${x.cuota_mensual} € · ref ${x.sesiones_referencia}`
    : x.modalidad === "cuenta" ? `${x.tarifa} €/sesión` : `${x.sesiones_totales} × ${x.tarifa} €`;
  console.log(`     ciclo ${x.ciclo}: ${x.modalidad.padEnd(11)} ${cond.padEnd(26)} ${String(x.n).padStart(2)} sesiones · ` +
    `${x.pagado ? "PAGADO  " : "PENDIENTE"}${x.ciclo === x.ciclo_actual ? " <- en curso" : ""}`);
}
await c.end();
