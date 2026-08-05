/**
 * Cuánto tarda cada pantalla en pedirle sus datos a Supabase, y cuántos
 * viajes de red hace. Es la medida que importa en Vercel: allí cada consulta
 * cuesta ~180 ms, así que lo caro no es la consulta, es CUÁNTAS hay.
 */
import { readFile } from "node:fs/promises";
import pg from "pg";

const env = Object.fromEntries(
  (await readFile(".env.local", "utf8")).split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
await pool.query("select 1");

let viajes = 0;
const q = async (sql, params) => { viajes += 1; return (await pool.query(sql, params)).rows; };

const CAMPOS = "cliente_id, ciclo, modalidad, servicio, tarifa, sesiones_totales, precio_total, " +
  "cuota_mensual, sesiones_referencia, anio, mes, fecha_inicio, fecha_fin, pagado";

async function listaAntes() {
  viajes = 0;
  const t = performance.now();
  const clientes = await q("select * from clientes order by nombre");
  for (const c of clientes) {
    await q(`select ${CAMPOS} from ciclos where cliente_id=$1 and ciclo=(select ciclo_actual from clientes where id=$1)`, [c.id]);
    await q("select * from cargos_mensuales where cliente_id=$1", [c.id]);
    await q("select count(*)::int n from sesiones where cliente_id=$1 and ciclo=$2", [c.id, c.ciclo_actual]);
    await q(`select ${CAMPOS} from ciclos where cliente_id=$1 order by ciclo desc`, [c.id]);
    await q("select * from cargos_mensuales where cliente_id=$1", [c.id]);
  }
  return { ms: performance.now() - t, viajes };
}

async function listaAhora() {
  viajes = 0;
  const t = performance.now();
  await Promise.all([
    q("select * from clientes order by nombre"),
    q(`select ${CAMPOS} from ciclos order by cliente_id, ciclo desc`),
    q("select * from cargos_mensuales"),
    q("select cliente_id, ciclo, count(*)::int as n from sesiones group by cliente_id, ciclo"),
  ]);
  return { ms: performance.now() - t, viajes };
}

async function perfilAntes(id) {
  viajes = 0;
  const t = performance.now();
  await q("select * from clientes where id=$1", [id]);
  await q(`select ${CAMPOS} from ciclos where cliente_id=$1 and ciclo=(select ciclo_actual from clientes where id=$1)`, [id]);
  await q("select * from cargos_mensuales where cliente_id=$1", [id]);
  await q("select count(*)::int n from sesiones where cliente_id=$1 and ciclo=1", [id]);
  await q(`select ${CAMPOS} from ciclos where cliente_id=$1 order by ciclo desc`, [id]);
  await q("select * from cargos_mensuales where cliente_id=$1", [id]);
  await q("select * from sesiones where cliente_id=$1 order by fecha desc", [id]);
  return { ms: performance.now() - t, viajes };
}

async function perfilAhora(id) {
  viajes = 0;
  const t = performance.now();
  await q("select * from clientes where id=$1", [id]);
  await Promise.all([
    (async () => { await q(`select ${CAMPOS} from ciclos where cliente_id=$1 order by ciclo desc`, [id]);
                   await q("select * from cargos_mensuales where cliente_id=$1", [id]); })(),
    q("select * from sesiones where cliente_id=$1 order by fecha desc", [id]),
  ]);
  return { ms: performance.now() - t, viajes };
}

async function economiaAntes() {
  viajes = 0;
  const t = performance.now();
  await q("select * from semanas order by inicio desc");
  const meses = await q(`select distinct extract(year from fecha)::int anio, extract(month from fecha)::int mes from sesiones order by 1 desc, 2 desc`);
  for (const m of meses) {
    const desde = `${m.anio}-${String(m.mes).padStart(2, "0")}-01`;
    await q("select s.fecha, s.tarifa from sesiones s where s.fecha >= $1::date and s.fecha < ($1::date + interval '1 month')", [desde]);
    await q("select importe from cargos_mensuales where anio=$1 and mes=$2", [m.anio, m.mes]);
    await q("select tipo, count(*)::int n from clases_grupo where fecha >= $1::date and fecha < ($1::date + interval '1 month') group by tipo", [desde]);
    await q("select origen, importe, horas, motivo from ajustes_mensuales where anio=$1 and mes=$2", [m.anio, m.mes]);
  }
  await q("select tipo, count(*)::int n from clases_grupo where fecha between $1 and $2 group by tipo", ["2026-08-03", "2026-08-09"]);
  return { ms: performance.now() - t, viajes };
}

async function economiaAhora() {
  viajes = 0;
  const t = performance.now();
  const [, meses] = await Promise.all([
    q("select * from semanas order by inicio desc"),
    q(`select distinct extract(year from fecha)::int anio, extract(month from fecha)::int mes from sesiones order by 1 desc, 2 desc`),
    q("select tipo, count(*)::int n from clases_grupo where fecha between $1 and $2 group by tipo", ["2026-08-03", "2026-08-09"]),
  ]);
  await Promise.all(meses.map(async (m) => {
    const desde = `${m.anio}-${String(m.mes).padStart(2, "0")}-01`;
    await Promise.all([
      q("select s.fecha, s.tarifa from sesiones s where s.fecha >= $1::date and s.fecha < ($1::date + interval '1 month')", [desde]),
      q("select importe from cargos_mensuales where anio=$1 and mes=$2", [m.anio, m.mes]),
      q("select tipo, count(*)::int n from clases_grupo where fecha >= $1::date and fecha < ($1::date + interval '1 month') group by tipo", [desde]),
      q("select origen, importe, horas, motivo from ajustes_mensuales where anio=$1 and mes=$2", [m.anio, m.mes]),
    ]);
  }));
  return { ms: performance.now() - t, viajes };
}

const [{ id }] = await pool.query("select id from clientes limit 1").then((r) => r.rows);

console.log("PANTALLA DE CLIENTES");
const a1 = await listaAntes(), b1 = await listaAhora();
console.log(`  antes   ${a1.viajes.toString().padStart(2)} consultas  ${a1.ms.toFixed(0).padStart(5)} ms`);
console.log(`  ahora   ${b1.viajes.toString().padStart(2)} consultas  ${b1.ms.toFixed(0).padStart(5)} ms   → ${(a1.ms / b1.ms).toFixed(1)}× más rápida`);

console.log("\nPERFIL DE UN CLIENTE");
const a2 = await perfilAntes(id), b2 = await perfilAhora(id);
console.log(`  antes   ${a2.viajes.toString().padStart(2)} consultas  ${a2.ms.toFixed(0).padStart(5)} ms`);
console.log(`  ahora   ${b2.viajes.toString().padStart(2)} consultas  ${b2.ms.toFixed(0).padStart(5)} ms   → ${(a2.ms / b2.ms).toFixed(1)}× más rápido`);

console.log("");
console.log("ECONOMÍA");
const a3 = await economiaAntes(), b3 = await economiaAhora();
console.log(`  antes   ${a3.viajes.toString().padStart(2)} consultas  ${a3.ms.toFixed(0).padStart(5)} ms`);
console.log(`  ahora   ${b3.viajes.toString().padStart(2)} consultas  ${b3.ms.toFixed(0).padStart(5)} ms   → ${(a3.ms / b3.ms).toFixed(1)}× más rápida`);

await pool.end();
