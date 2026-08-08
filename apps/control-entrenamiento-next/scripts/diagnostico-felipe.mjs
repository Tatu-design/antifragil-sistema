import { readFile } from "node:fs/promises";
import pg from "pg";
const env = Object.fromEntries(
  (await readFile(".env.local", "utf8")).split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows: cl } = await c.query("select * from clientes where nombre ilike '%Felipe%'");
const cliente = cl[0];
console.log(`CLIENTE: ${cliente.nombre}  (ciclo en curso: ${cliente.ciclo_actual})\n`);

const { rows: ciclos } = await c.query(
  "select * from ciclos where cliente_id = $1 order by ciclo", [cliente.id]);
console.log("SERVICIOS GUARDADOS");
for (const x of ciclos) {
  console.log(`  ciclo ${x.ciclo}: ${x.modalidad.toUpperCase()}  «${x.servicio}»`);
  console.log(`      tarifa=${x.tarifa}  sesiones_totales=${x.sesiones_totales}  precio_total=${x.precio_total}`);
  console.log(`      cuota_mensual=${x.cuota_mensual}  ref=${x.sesiones_referencia}  anio/mes=${x.anio}/${x.mes}`);
  console.log(`      desde ${x.fecha_inicio} hasta ${x.fecha_fin ?? "en curso"}  ·  ${x.pagado ? "PAGADO" : "pendiente"}`);
}

const { rows: ses } = await c.query(
  "select ciclo, fecha, numero_sesion, tarifa from sesiones where cliente_id = $1 order by fecha", [cliente.id]);
console.log("\nSESIONES");
for (const s of ses) {
  console.log(`  ciclo ${s.ciclo}  ${String(s.fecha).slice(0,10)}  nº${String(s.numero_sesion).padStart(2)}  ` +
    `${s.tarifa === null ? "sin importe (mensualidad)" : s.tarifa + " €"}`);
}

console.log("\nECONOMÍA ACTUAL POR MES (lo que hay hoy)");
const { rows: meses } = await c.query(`
  select to_char(fecha,'YYYY-MM') mes, count(*)::int horas, coalesce(sum(tarifa),0)::float dinero_sesiones
    from sesiones group by 1 order by 1`);
const { rows: cuotas } = await c.query(
  "select anio, mes, sum(importe)::float cuota from cargos_mensuales group by 1,2 order by 1,2");
for (const m of meses) {
  const q = cuotas.find((x) => `${x.anio}-${String(x.mes).padStart(2,"0")}` === m.mes);
  const total = m.dinero_sesiones + (q?.cuota ?? 0);
  console.log(`  ${m.mes}: sesiones ${m.dinero_sesiones.toFixed(2)} € + cuotas ${(q?.cuota ?? 0).toFixed(2)} € ` +
    `= ${total.toFixed(2)} €   ·  ${m.horas} h`);
}
await c.end();
