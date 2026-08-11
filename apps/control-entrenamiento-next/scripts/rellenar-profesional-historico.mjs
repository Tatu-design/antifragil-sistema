/**
 * Rellena el profesional responsable en las filas históricas.
 *
 *   node scripts/rellenar-profesional-historico.mjs            → SOLO enseña
 *   node scripts/rellenar-profesional-historico.mjs --aplicar  → lo aplica
 *
 * POR QUÉ HACE FALTA
 *
 * Cada sesión guarda ya de quién era el cliente cuando se firmó, pero las
 * anteriores al 2026-08-11 no lo tienen. Mientras esas filas estén vacías, la
 * economía las atribuye por una regla de respaldo:
 *
 *   - anteriores al 2026-08-09 (cuando no existían los profesionales) → admin;
 *   - posteriores → el responsable ACTUAL del cliente.
 *
 * Eso da hoy el resultado correcto, pero la segunda regla es frágil: el día
 * que un cliente cambie de profesional, esas sesiones se irían con él aunque
 * no fueran suyas. Rellenarlas cierra el hueco para siempre.
 *
 * QUÉ ESCRIBE
 *
 * Solo la columna `profesional_id`, que hoy está vacía. Ni un importe, ni una
 * fecha, ni un ciclo. La economía no cambia: se comprueba antes y después.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const APLICAR = process.argv.includes("--aplicar");
const CORTE = "2026-08-09";

const env = Object.fromEntries(
  (await readFile(path.join(AQUI, "..", ".env.local"), "utf8"))
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const bd = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await bd.connect();

const eur = (v) => `${Number(v).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const admin = (await bd.query("select id, nombre from perfiles where rol='admin' order by creado limit 1")).rows[0];
if (!admin) { console.log("No hay administrador. No se toca nada."); await bd.end(); process.exit(1); }

// ---------------------------------------------------------------------------
// 1. Qué filas cambiarían
// ---------------------------------------------------------------------------

const antes = (await bd.query(
  `select cl.nombre cliente, count(*)::int n, coalesce(sum(s.tarifa),0)::float dinero,
          min(s.fecha) desde, max(s.fecha) hasta
     from sesiones s join clientes cl on cl.id = s.cliente_id
    where s.profesional_id is null and s.fecha < $1::date
    group by cl.nombre order by cl.nombre`, [CORTE])).rows;

const despues = (await bd.query(
  `select cl.nombre cliente, p.nombre responsable, count(*)::int n,
          coalesce(sum(s.tarifa),0)::float dinero, min(s.fecha) desde, max(s.fecha) hasta
     from sesiones s join clientes cl on cl.id = s.cliente_id
     left join perfiles p on p.id = cl.entrenador_id
    where s.profesional_id is null and s.fecha >= $1::date
    group by cl.nombre, p.nombre order by cl.nombre`, [CORTE])).rows;

console.log("RELLENO DEL PROFESIONAL HISTÓRICO");
console.log(`\nModo: ${APLICAR ? "APLICAR" : "solo vista previa (no se escribe nada)"}`);
console.log(`Frontera: ${CORTE}, el día que se crearon los profesionales.\n`);

console.log(`GRUPO 1 — ANTES DE QUE EXISTIERAN LOS PROFESIONALES → «${admin.nombre}»\n`);
let n1 = 0, d1 = 0;
for (const f of antes) {
  n1 += f.n; d1 += f.dinero;
  console.log(`  ${f.cliente.padEnd(16)} ${String(f.n).padStart(3)} ses  ${String(f.desde).slice(0,10)} → ${String(f.hasta).slice(0,10)}  ${eur(f.dinero).padStart(11)}`);
}
console.log(`  ${"".padEnd(16)} ${String(n1).padStart(3)} ses en total${" ".repeat(24)}${eur(d1).padStart(11)}`);

console.log(`\nGRUPO 2 — DESDE ESA FECHA → su responsable actual\n`);
let n2 = 0, d2 = 0;
for (const f of despues) {
  n2 += f.n; d2 += f.dinero;
  console.log(`  ${f.cliente.padEnd(16)} ${String(f.n).padStart(3)} ses  ${String(f.desde).slice(0,10)} → ${String(f.hasta).slice(0,10)}  ${eur(f.dinero).padStart(11)}  → ${f.responsable ?? "(SIN RESPONSABLE)"}`);
}
console.log(`  ${"".padEnd(16)} ${String(n2).padStart(3)} ses en total${" ".repeat(24)}${eur(d2).padStart(11)}`);

const huerfanas = despues.filter((f) => !f.responsable);
if (huerfanas.length) {
  console.log(`\n  ⚠ ${huerfanas.length} grupo(s) sin responsable actual: NO se pueden resolver solos.`);
}

const cuotas = (await bd.query(
  `select count(*)::int n from cargos_mensuales where profesional_id is null`)).rows[0].n;
console.log(`\nCUOTAS DE MENSUALIDAD: ${cuotas} filas, todas al administrador (solo él las lleva).`);

// ---------------------------------------------------------------------------
// 2. Impacto económico
// ---------------------------------------------------------------------------

const totales = async () => (await bd.query(
  `select (select count(*)::int from sesiones) ses,
          coalesce((select sum(tarifa) from sesiones),0)::float dinero,
          (select count(*)::int from ciclos) ciclos,
          coalesce((select sum(importe) from cargos_mensuales),0)::float cuotas`)).rows[0];

const t0 = await totales();
console.log("\nIMPACTO ECONÓMICO\n");
console.log("  Ninguno. Se escribe UNA columna que hoy está vacía. Lo que debe");
console.log("  quedar exactamente igual:");
console.log(`    sesiones ${t0.ses} · facturado ${eur(t0.dinero)} · ciclos ${t0.ciclos} · cuotas ${eur(t0.cuotas)}`);

console.log("\nCÓMO VOLVER ATRÁS\n");
console.log("  update sesiones set profesional_id = null;");
console.log("  update cargos_mensuales set profesional_id = null;");
console.log("  (vuelve al estado de ahora: la economía se recalcula por la regla de respaldo)");

if (!APLICAR) {
  console.log("\n---\nNo se ha escrito NADA. Para aplicarlo:");
  console.log("  node scripts/rellenar-profesional-historico.mjs --aplicar");
  await bd.end();
  process.exit(0);
}

if (huerfanas.length) {
  console.log("\n✗ Hay filas sin responsable claro. No se aplica nada: eso hay que decidirlo antes.");
  await bd.end();
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3. Aplicar, con copia y comprobación
// ---------------------------------------------------------------------------

const copias = path.join(AQUI, "..", ".copias");
await mkdir(copias, { recursive: true });
const ruta = path.join(copias, `profesional-historico-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
await writeFile(ruta, JSON.stringify(
  (await bd.query("select id, profesional_id from sesiones")).rows, null, 2), "utf8");
console.log(`\n  Copia guardada en: ${ruta}`);

await bd.query("begin");
try {
  const a = await bd.query(
    "update sesiones set profesional_id = $1 where profesional_id is null and fecha < $2::date",
    [admin.id, CORTE]);
  const b = await bd.query(
    `update sesiones s set profesional_id = cl.entrenador_id
       from clientes cl
      where cl.id = s.cliente_id and s.profesional_id is null and s.fecha >= $1::date
        and cl.entrenador_id is not null`, [CORTE]);
  const c = await bd.query(
    "update cargos_mensuales set profesional_id = $1 where profesional_id is null", [admin.id]);

  const t1 = await totales();
  const igual = t1.ses === t0.ses && Math.round(t1.dinero * 100) === Math.round(t0.dinero * 100)
    && t1.ciclos === t0.ciclos && Math.round(t1.cuotas * 100) === Math.round(t0.cuotas * 100);
  if (!igual) throw new Error("Algo más ha cambiado. Se deshace todo.");

  await bd.query("commit");
  console.log(`\n  ✓ ${a.rowCount} sesiones al administrador · ${b.rowCount} a su responsable · ${c.rowCount} cuotas.`);
  console.log("  ✓ Sesiones, ciclos, facturación y cuotas sin un solo cambio.");
} catch (e) {
  await bd.query("rollback");
  console.log(`\n  ✗ No se ha aplicado nada: ${e.message}`);
  process.exitCode = 1;
}

await bd.end();
