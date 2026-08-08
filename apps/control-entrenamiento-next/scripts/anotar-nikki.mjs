/**
 * Completa el bono de julio de Nikki: cuatro sesiones que faltaban.
 *
 * Se usan las fechas libres de julio que siguen a su última sesión (vie 24) y
 * encajan con sus días habituales. Fernando dijo que las fechas concretas dan
 * igual mientras estén en julio.
 *
 * Se registran con `firmar_sesion`, la función de la propia base de datos: es
 * la misma que se usa desde el móvil, así que el cierre del bono, la
 * renovación y la economía de cada semana salen exactamente igual que si se
 * hubieran firmado ese día. Nada escrito a mano por debajo.
 */
import { readFile } from "node:fs/promises";
import pg from "pg";

const env = Object.fromEntries(
  (await readFile(".env.local", "utf8")).split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const FECHAS = ["2026-07-27", "2026-07-29", "2026-07-30", "2026-07-31"];

const foto = async (id) => {
  const { rows: cl } = await c.query("select sesiones_completadas, ciclo_actual, pendiente_pago from clientes where id=$1", [id]);
  const { rows: ci } = await c.query("select ciclo, sesiones_totales, tarifa, precio_total, fecha_inicio, fecha_fin, pagado from ciclos where cliente_id=$1 order by ciclo", [id]);
  const { rows: m } = await c.query("select to_char(fecha,'YYYY-MM') mes, count(*)::int h, coalesce(sum(tarifa),0)::float d from sesiones group by 1 order by 1");
  return { cliente: cl[0], ciclos: ci, meses: m };
};

const { rows } = await c.query("select id from clientes where nombre='Nikki'");
const id = rows[0].id;

const antes = await foto(id);
console.log("ANTES");
console.log(`  contador ${antes.cliente.sesiones_completadas} de 16 · ciclo ${antes.cliente.ciclo_actual}`);
for (const m of antes.meses) console.log(`  ${m.mes}: ${m.d.toFixed(2)} € · ${m.h} h`);

console.log("\nREGISTRANDO");
for (const fecha of FECHAS) {
  const { rows: r } = await c.query(
    "select firmar_sesion($1::uuid, $2::date, '10:00'::time, $3::text) as resultado",
    [id, fecha, `nikki-julio-${fecha}`]);
  const x = r[0].resultado;
  console.log(`  ${fecha}  →  sesión ${x.numero_sesion} de ${x.sesiones_totales}` +
    (x.renovado ? "   ← COMPLETA EL BONO: se cierra y se abre uno nuevo" : ""));
}

const despues = await foto(id);
console.log("\nDESPUÉS");
console.log(`  contador ${despues.cliente.sesiones_completadas} de 16 · ciclo ${despues.cliente.ciclo_actual} · ` +
  `${despues.cliente.pendiente_pago ? "pendiente de pago" : "pagado"}`);
for (const x of despues.ciclos) {
  const f = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "en curso");
  console.log(`  bono ${x.ciclo}: ${x.sesiones_totales} × ${x.tarifa} € = ${x.precio_total} € · ` +
    `${f(x.fecha_inicio)} → ${f(x.fecha_fin)} · ${x.pagado ? "PAGADO" : "PENDIENTE DE PAGO"}`);
}
console.log("");
for (const m of despues.meses) {
  const a = antes.meses.find((x) => x.mes === m.mes);
  const dif = m.d - (a?.d ?? 0);
  console.log(`  ${m.mes}: ${m.d.toFixed(2)} € · ${m.h} h` + (dif ? `   (${dif > 0 ? "+" : ""}${dif.toFixed(2)} €)` : "   (sin cambio)"));
}
await c.end();
