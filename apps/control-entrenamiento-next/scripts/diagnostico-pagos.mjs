/**
 * Diagnóstico del estado de cobro antes de unificarlo a dos estados.
 *
 * Solo lee. Enseña qué filas tienen `pagado = null` («no se sabe», que deja
 * de existir), qué se propone para cada una y qué impacto económico tiene.
 */
import { readFile } from "node:fs/promises";
import pg from "pg";

const env = Object.fromEntries(
  (await readFile(".env.local", "utf8")).split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows } = await c.query(`
  select cl.nombre, cl.estado, ci.ciclo, ci.modalidad, ci.servicio, ci.pagado,
         ci.fecha_inicio, ci.fecha_fin, ci.ciclo = cl.ciclo_actual as es_actual,
         (select count(*)::int from sesiones s where s.cliente_id = ci.cliente_id and s.ciclo = ci.ciclo) sesiones
    from ciclos ci join clientes cl on cl.id = ci.cliente_id
   order by cl.nombre, ci.ciclo`);

console.log("ESTADO DE COBRO DE TODOS LOS SERVICIOS (solo lectura)\n");
const nulos = [];
for (const r of rows) {
  const estado = r.pagado === null ? "NULL (no se sabe)" : r.pagado ? "pagado" : "pendiente";
  const marca = r.pagado === null ? "⚠" : " ";
  console.log(`  ${marca} ${r.nombre.padEnd(15)} ciclo ${r.ciclo} · ${r.modalidad.padEnd(12)} · ` +
    `${r.sesiones} sesiones · ${r.es_actual ? "EN CURSO" : "cerrado "} · cliente ${r.estado.padEnd(9)} · ${estado}`);
  if (r.pagado === null) nulos.push(r);
}

console.log(`\nFilas con NULL: ${nulos.length}`);
if (nulos.length) {
  console.log("\nPropuesta: NULL -> pendiente de pago (false).");
  console.log("Motivo: nadie confirmó nunca que se pagara. Darlo por cobrado");
  console.log("inventaría un ingreso; dejarlo pendiente solo dice la verdad.");
  for (const r of nulos) {
    console.log(`   ${r.nombre} ciclo ${r.ciclo} (${r.modalidad}, cliente ${r.estado}): null -> pendiente`);
  }
}

const { rows: cargos } = await c.query("select count(*)::int n from cargos_mensuales where pagado is null");
console.log(`\ncargos_mensuales con NULL: ${cargos[0].n}`);

console.log("\nIMPACTO ECONÓMICO: ninguno. `pagado` no entra en ningún cálculo de");
console.log("facturación, horas ni precio medio — solo dice si está cobrado.");
console.log("ROLLBACK: la copia de `.data/copias/` restaura el estado exacto.");
await c.end();
