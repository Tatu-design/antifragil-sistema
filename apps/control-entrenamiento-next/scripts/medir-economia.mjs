/**
 * Cuántas consultas SQL hace la pantalla de Economía, antes y después de la
 * simplificación del 2026-08-08. Solo lee.
 */
import { readFile } from "node:fs/promises";
import pg from "pg";

const env = Object.fromEntries(
  (await readFile(".env.local", "utf8")).split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 });
await pool.query("select 1");

let n = 0;
const q = async (sql, params) => { n += 1; return (await pool.query(sql, params)).rows; };

const mesesConDatos = () => q(`
  select distinct extract(year from fecha)::int anio, extract(month from fecha)::int mes from sesiones
  union select distinct extract(year from fecha)::int, extract(month from fecha)::int from clases_grupo
  union select distinct anio, mes from cargos_mensuales
  union select distinct anio, mes from ajustes_mensuales
  order by 1 desc, 2 desc`);

/** Las cinco consultas de un mes, en paralelo. */
const datosDelMes = async (anio, mes) => {
  const desde = `${anio}-${String(mes).padStart(2, "0")}-01`;
  await Promise.all([
    q("select s.fecha, s.tarifa from sesiones s where s.fecha >= $1::date and s.fecha < ($1::date + interval '1 month')", [desde]),
    q("select importe from cargos_mensuales where anio=$1 and mes=$2", [anio, mes]),
    q("select tipo, count(*)::int n from clases_grupo where fecha >= $1::date and fecha < ($1::date + interval '1 month') group by tipo", [desde]),
    q("select origen, importe, horas, motivo from ajustes_mensuales where anio=$1 and mes=$2", [anio, mes]),
    q("select importe from facturacion_kids_mensual where anio=$1 and mes=$2", [anio, mes]),
  ]);
};

async function antes() {
  n = 0;
  const t = performance.now();
  const [, meses] = await Promise.all([
    q("select * from semanas order by inicio desc"),                              // listarSemanas
    mesesConDatos(),
    q("select tipo, count(*)::int n from clases_grupo where fecha between $1 and $2 group by tipo",
      ["2026-08-03", "2026-08-09"]),                                              // contarClases
  ]);
  await Promise.all(meses.map((m) => datosDelMes(m.anio, m.mes)));
  return { n, ms: performance.now() - t, meses: meses.length };
}

async function ahora() {
  n = 0;
  const t = performance.now();
  const meses = await mesesConDatos();
  const hoy = new Date();
  const anteriores = meses.filter((m) => m.anio !== hoy.getFullYear() || m.mes !== hoy.getMonth() + 1);
  await Promise.all([
    datosDelMes(hoy.getFullYear(), hoy.getMonth() + 1),
    ...anteriores.map((m) => datosDelMes(m.anio, m.mes)),
  ]);
  return { n, ms: performance.now() - t, meses: anteriores.length + 1 };
}

const a = await antes(), b = await ahora();
console.log("PANTALLA DE ECONOMÍA\n");
console.log(`  antes   ${String(a.n).padStart(2)} consultas SQL  ${a.ms.toFixed(0).padStart(5)} ms   (${a.meses} meses)`);
console.log(`  ahora   ${String(b.n).padStart(2)} consultas SQL  ${b.ms.toFixed(0).padStart(5)} ms   (${b.meses} meses)`);
console.log(`\n  ${a.n - b.n} consultas menos en cada carga.`);
await pool.end();
