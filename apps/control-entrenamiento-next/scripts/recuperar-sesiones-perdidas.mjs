/**
 * Recupera las horas que se perdieron en el hueco entre mensualidades.
 *
 *   node scripts/recuperar-sesiones-perdidas.mjs            → SOLO enseña
 *   node scripts/recuperar-sesiones-perdidas.mjs --aplicar  → lo aplica
 *
 * El 27 y el 29 de julio Felipe y Javi entrenaron, pero su mensualidad de
 * julio se había cerrado el 23 y la de agosto no empezaba hasta el 3: esas dos
 * horas no cabían en ningún programa y no llegaron a registrarse.
 *
 * La causa ya está corregida (`cicloDeLaFecha`): una mensualidad es un mes
 * natural y las sesiones de los últimos días del mes van a su mensualidad.
 * Esto solo repone lo que se perdió antes del arreglo.
 *
 * SON DOS FILAS NUEVAS, sin importe: en una mensualidad las sesiones cuentan
 * como horas trabajadas y la facturación es la cuota, hagan las que hagan.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import pg from "pg";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const APLICAR = process.argv.includes("--aplicar");

const env = Object.fromEntries(
  (await readFile(path.join(AQUI, "..", ".env.local"), "utf8"))
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const bd = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await bd.connect();

const eur = (v) => `${Number(v).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const CLIENTE = "Felipe y Javi";
const FECHAS = ["2026-07-27", "2026-07-29"];

const cliente = (await bd.query("select id, nombre from clientes where nombre = $1", [CLIENTE])).rows[0];
const ciclo = (await bd.query(
  "select ciclo, servicio, modalidad, anio, mes from ciclos where cliente_id = $1 and anio = 2026 and mes = 7",
  [cliente.id])).rows[0];

/** Julio entero, con las mismas reglas que la pantalla de Economía. */
async function julio() {
  const ses = (await bd.query(
    `select count(*)::int n, coalesce(sum(tarifa),0)::float d from sesiones
      where extract(year from fecha)=2026 and extract(month from fecha)=7`)).rows[0];
  const cuotas = (await bd.query(
    "select coalesce(sum(importe),0)::float d from cargos_mensuales where anio=2026 and mes=7")).rows[0].d;
  const clases = (await bd.query(
    `select coalesce(count(*),0)::int n from clases_grupo
      where extract(year from fecha)=2026 and extract(month from fecha)=7`)).rows[0].n;
  const horas = ses.n + clases;
  const dinero = ses.d + cuotas + clases * 15;
  return { horas, dinero, hora: horas ? dinero / horas : 0 };
}

const antes = await julio();

console.log("RECUPERAR LAS HORAS PERDIDAS EN EL HUECO");
console.log(`\nModo: ${APLICAR ? "APLICAR" : "solo vista previa (no se escribe nada)"}\n`);

console.log("QUÉ FILAS SE AÑADEN\n");
for (const f of FECHAS) {
  const ya = (await bd.query("select 1 from sesiones where cliente_id=$1 and fecha=$2::date", [cliente.id, f])).rowCount;
  const dia = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][new Date(f).getDay()];
  console.log(`  ${f} (${dia})  ${cliente.nombre}  sin importe  → programa de julio (ciclo ${ciclo.ciclo})${ya ? "   ⚠ YA EXISTE, se salta" : ""}`);
}
console.log(`\n  Son 2 filas nuevas en «sesiones». No se toca ninguna existente.`);
console.log(`  Sin importe, porque «${ciclo.servicio}» es una ${ciclo.modalidad}: la facturación es la cuota.`);

console.log("\nJULIO, ANTES Y DESPUÉS\n");
console.log(`                    ANTES          DESPUÉS`);
console.log(`  horas          ${String(antes.horas).padStart(7)}        ${String(antes.horas + 2).padStart(7)}`);
console.log(`  facturación  ${eur(antes.dinero).padStart(11)}      ${eur(antes.dinero).padStart(11)}   (no cambia)`);
console.log(`  € / hora     ${eur(antes.hora).padStart(11)}      ${eur(antes.dinero / (antes.horas + 2)).padStart(11)}`);

console.log("\nCÓMO VOLVER ATRÁS\n");
console.log(`  delete from sesiones where cliente_id = '${cliente.id}'`);
console.log(`    and fecha in ('${FECHAS.join("', '")}');`);

if (!APLICAR) {
  console.log("\n---\nNo se ha escrito NADA. Para aplicarlo:");
  console.log("  node scripts/recuperar-sesiones-perdidas.mjs --aplicar");
  await bd.end();
  process.exit(0);
}

const copias = path.join(AQUI, "..", ".copias");
await mkdir(copias, { recursive: true });
const ruta = path.join(copias, `sesiones-perdidas-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
await writeFile(ruta, JSON.stringify({ cliente: cliente.id, fechas: FECHAS, antes }, null, 2), "utf8");
console.log(`\n  Copia guardada en: ${ruta}`);

await bd.query("begin");
try {
  const admin = (await bd.query("select id from perfiles where rol='admin' limit 1")).rows[0];
  let n = (await bd.query("select count(*)::int c from sesiones where cliente_id=$1 and ciclo=$2",
    [cliente.id, ciclo.ciclo])).rows[0].c;

  for (const f of FECHAS) {
    const ya = (await bd.query("select 1 from sesiones where cliente_id=$1 and fecha=$2::date", [cliente.id, f])).rowCount;
    if (ya) continue;
    n += 1;
    await bd.query(
      `insert into sesiones (id, cliente_id, ciclo, fecha, hora, numero_sesion, sesiones_totales,
                             tarifa, servicio, profesional_id)
       values ($1,$2,$3,$4::date,null,$5,0,null,$6,$7)`,
      [randomUUID(), cliente.id, ciclo.ciclo, f, n, ciclo.servicio, admin.id]);
  }

  const despues = await julio();
  if (Math.abs(despues.dinero - antes.dinero) > 0.005) {
    throw new Error(`la facturación ha cambiado: ${antes.dinero} → ${despues.dinero}`);
  }

  await bd.query("commit");
  console.log(`\n  ✓ Julio: ${antes.horas} → ${despues.horas} horas · ${eur(despues.dinero)} · ${eur(despues.hora)}/h`);
  console.log("  ✓ La facturación no se ha movido, como debe ser en una mensualidad.");
} catch (e) {
  await bd.query("rollback");
  console.log(`\n  ✗ No se ha aplicado nada: ${e.message}`);
  process.exitCode = 1;
}

await bd.end();
