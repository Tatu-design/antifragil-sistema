/**
 * Convierte el servicio de JULIO de «Felipe y Javi» de bono a mensualidad.
 *
 * Se registró como bono de 16 sesiones a 60 €, pero la realidad era la misma
 * mensualidad que tienen ahora: 720 € al mes con 12 sesiones de referencia.
 * El sistema solo se enteró en agosto, cuando Fernando cambió la modalidad, y
 * por eso julio quedó guardado como lo que ya no era.
 *
 *   node scripts/corregir-julio-felipe.mjs            → solo enseña
 *   node scripts/corregir-julio-felipe.mjs --aplicar  → lo aplica
 *
 * CAMBIA DINERO: julio pasa de facturar 11 sesiones × 60 € a facturar una
 * cuota de 720 €. Por eso el modo por defecto es mirar, no tocar.
 */
import { readFile } from "node:fs/promises";
import pg from "pg";

const env = Object.fromEntries(
  (await readFile(".env.local", "utf8")).split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const aplicar = process.argv.includes("--aplicar");
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const CUOTA = 720, REFERENCIA = 12, ANIO = 2026, MES = 7;

const { rows: cl } = await c.query("select * from clientes where nombre = 'Felipe y Javi'");
const cliente = cl[0];
const { rows: ciclos } = await c.query(
  "select * from ciclos where cliente_id = $1 and ciclo = 1", [cliente.id]);
const julio = ciclos[0];
const { rows: ses } = await c.query(
  "select id, fecha, tarifa from sesiones where cliente_id = $1 and ciclo = 1 order by fecha", [cliente.id]);

const economia = async () => {
  const { rows } = await c.query(
    "select to_char(fecha,'YYYY-MM') mes, count(*)::int horas, coalesce(sum(tarifa),0)::float d from sesiones group by 1 order by 1");
  const { rows: q } = await c.query("select anio, mes, sum(importe)::float cuota from cargos_mensuales group by 1,2");
  return rows.map((m) => {
    const cuota = q.find((x) => `${x.anio}-${String(x.mes).padStart(2, "0")}` === m.mes)?.cuota ?? 0;
    return { mes: m.mes, horas: m.horas, total: m.d + cuota };
  });
};

const antes = await economia();

console.log(`\n${aplicar ? "APLICANDO" : "PREVISUALIZACIÓN — no se escribe nada"}\n`);
console.log("1) FILAS QUE CAMBIAN\n");
console.log(`   ciclos (1 fila): ciclo 1 de ${cliente.nombre}`);
console.log(`      modalidad          bono            ->  mensualidad`);
console.log(`      tarifa             ${julio.tarifa} €          ->  (ninguna: sus sesiones no llevan importe)`);
console.log(`      sesiones_totales   ${julio.sesiones_totales}              ->  0 (una mensualidad no tiene tope)`);
console.log(`      precio_total       ${julio.precio_total} €         ->  (ninguno)`);
console.log(`      cuota_mensual      —               ->  ${CUOTA.toFixed(2)} €`);
console.log(`      sesiones_referencia —              ->  ${REFERENCIA}`);
console.log(`      anio / mes         — / —          ->  ${ANIO} / ${MES}`);
console.log(`      pagado             ${julio.pagado}            ->  ${julio.pagado} (sin cambio)`);
console.log(`\n   sesiones (${ses.length} filas): pierden su importe y pasan a contar solo como horas`);
for (const s of ses) console.log(`      ${String(s.fecha).slice(0, 10)}  ${s.tarifa} €  ->  sin importe`);
console.log(`\n   cargos_mensuales (1 fila NUEVA): ${cliente.nombre}, ${ANIO}-${String(MES).padStart(2,"0")}, ${CUOTA.toFixed(2)} €, pagado`);

if (!aplicar) {
  const sesionesJulio = ses.reduce((a, s) => a + Number(s.tarifa ?? 0), 0);
  const julioAntes = antes.find((m) => m.mes === "2026-07");
  const nuevoTotal = julioAntes.total - sesionesJulio + CUOTA;
  console.log("\n2) IMPACTO ECONÓMICO\n");
  for (const m of antes) {
    const cambia = m.mes === "2026-07";
    console.log(`   ${m.mes}: ${m.total.toFixed(2)} € / ${m.horas} h` +
      (cambia ? `   ->   ${nuevoTotal.toFixed(2)} € / ${m.horas} h   (${(nuevoTotal - m.total >= 0 ? "+" : "")}${(nuevoTotal - m.total).toFixed(2)} €)` : "   (sin cambio)"));
  }
  console.log(`\n   Las horas NO cambian: las ${ses.length} sesiones siguen ahí, solo dejan de llevar precio.`);
  console.log("   No se toca ninguna fecha, ni el token, ni se borra ni se crea ninguna sesión.");
  console.log("\n3) VUELTA ATRÁS: la copia de `.data/copias/` restaura el estado exacto.");
  console.log("\n(nada guardado; ejecuta con --aplicar cuando lo apruebes)\n");
  await c.end();
  process.exit(0);
}

await c.query("begin");
try {
  await c.query(
    `update ciclos set modalidad='mensualidad', tarifa=null, sesiones_totales=0, precio_total=null,
            cuota_mensual=$2, sesiones_referencia=$3, anio=$4, mes=$5
      where cliente_id=$1 and ciclo=1`,
    [cliente.id, CUOTA, REFERENCIA, ANIO, MES]);
  await c.query("update sesiones set tarifa = null where cliente_id = $1 and ciclo = 1", [cliente.id]);
  await c.query(
    `insert into cargos_mensuales (cliente_id, anio, mes, concepto, ciclo, importe, pagado)
     values ($1,$2,$3,'mensualidad',1,$4,$5)
     on conflict (cliente_id, anio, mes, concepto) do update set importe = excluded.importe`,
    [cliente.id, ANIO, MES, CUOTA, julio.pagado]);
  await c.query("commit");
} catch (e) { await c.query("rollback"); throw e; }

const despues = await economia();
console.log("\n2) ECONOMÍA\n");
for (const m of antes) {
  const d = despues.find((x) => x.mes === m.mes);
  console.log(`   ${m.mes}: ${m.total.toFixed(2)} € / ${m.horas} h  ->  ${d.total.toFixed(2)} € / ${d.horas} h`);
}
await c.end();
