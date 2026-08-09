/**
 * Reparte los clientes existentes entre profesionales.
 *
 *   node scripts/repartir-clientes.mjs            → SOLO enseña qué cambiaría
 *   node scripts/repartir-clientes.mjs --aplicar  → lo aplica, tras copia
 *
 * Por qué existe en vez de un UPDATE a mano: son datos reales, y la regla del
 * proyecto (2026-08-04) exige enseñar antes qué filas cambian, el estado antes
 * y después, el impacto económico, el motivo y la forma de volver atrás. Este
 * script lo hace en ese orden y no aplica nada si no se le pide.
 *
 * Solo toca UNA columna: `clientes.entrenador_id`, que hasta hoy estaba vacía
 * en todas las filas. No roza sesiones, ciclos, cuotas, tokens ni economía.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const APLICAR = process.argv.includes("--aplicar");

const env = Object.fromEntries(
  (await readFile(path.join(AQUI, "..", ".env.local"), "utf8"))
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const cliente = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await cliente.connect();

// ---------------------------------------------------------------------------
// Volver atrás
// ---------------------------------------------------------------------------
// Restaura la columna EXACTAMENTE como estaba, fila por fila, desde la copia.
// No adivina: si la copia dice `null`, vuelve a `null`.

const iDeshacer = process.argv.indexOf("--deshacer");
if (iDeshacer !== -1) {
  const nombre = process.argv[iDeshacer + 1];
  if (!nombre) {
    console.log("Falta el nombre de la copia. Están en `.copias/`.");
    await cliente.end();
    process.exit(1);
  }
  const copia = JSON.parse(await readFile(path.join(AQUI, "..", ".copias", nombre), "utf8"));

  await cliente.query("begin");
  try {
    for (const fila of copia) {
      await cliente.query("update clientes set entrenador_id = $2 where id = $1", [
        fila.id,
        fila.entrenador_id,
      ]);
    }
    await cliente.query("commit");
    console.log(`✓ ${copia.length} clientes devueltos a como estaban en ${nombre}.`);
  } catch (error) {
    await cliente.query("rollback");
    console.log(`✗ No se ha deshecho nada: ${error.message}`);
    process.exitCode = 1;
  }
  await cliente.end();
  process.exit();
}

const eur = (v) =>
  `${Number(v).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

// ---------------------------------------------------------------------------
// 1. Qué filas cambiarían
// ---------------------------------------------------------------------------

const admin = (
  await cliente.query("select id, nombre from perfiles where rol = 'admin' order by creado limit 1")
).rows[0];

if (!admin) {
  console.log("No hay ningún administrador en `perfiles`. No se toca nada.");
  await cliente.end();
  process.exit(1);
}

const filas = (
  await cliente.query(`
    select c.id, c.nombre, c.estado, c.entrenador_id,
           (select count(*)::int from sesiones s where s.cliente_id = c.id) as sesiones,
           (select count(*)::int from ciclos y where y.cliente_id = c.id) as ciclos,
           coalesce((select sum(s.tarifa) from sesiones s where s.cliente_id = c.id), 0)::float as facturado
      from clientes c
     order by c.nombre`)
).rows;

const sinResponsable = filas.filter((f) => f.entrenador_id === null);

console.log("REPARTO DE CLIENTES ENTRE PROFESIONALES");
console.log(`\nModo: ${APLICAR ? "APLICAR" : "solo vista previa (no se escribe nada)"}\n`);
console.log(`Motivo: hasta hoy la aplicación era de una sola persona, así que`);
console.log(`ningún cliente tenía responsable. Entra Rafa como entrenador y`);
console.log(`hay que decir de quién es cada uno. Los ${filas.length} actuales son de`);
console.log(`«${admin.nombre}», que es quien los ha llevado siempre.\n`);

console.log("QUÉ FILAS CAMBIARÍAN\n");
console.log("  cliente".padEnd(26), "estado".padEnd(10), "antes".padEnd(14), "después");
console.log("  " + "-".repeat(70));
for (const f of filas) {
  const antes = f.entrenador_id === null ? "(sin asignar)" : f.entrenador_id.slice(0, 8);
  const despues = f.entrenador_id === null ? admin.nombre : "(sin cambio)";
  console.log("  " + f.nombre.padEnd(24), f.estado.padEnd(10), antes.padEnd(14), despues);
}
console.log(`\n  Filas que cambian: ${sinResponsable.length} de ${filas.length}`);

// ---------------------------------------------------------------------------
// 2. Impacto económico
// ---------------------------------------------------------------------------

const totalSesiones = filas.reduce((a, f) => a + f.sesiones, 0);
const totalCiclos = filas.reduce((a, f) => a + f.ciclos, 0);
const totalFacturado = filas.reduce((a, f) => a + f.facturado, 0);

console.log("\nIMPACTO ECONÓMICO\n");
console.log(`  Ninguno. Se escribe UNA columna que hoy está vacía en todas las`);
console.log(`  filas (\`clientes.entrenador_id\`). No se tocan sesiones, ciclos,`);
console.log(`  cuotas, tokens ni economía.\n`);
console.log(`  Lo que debe quedar exactamente igual después:`);
console.log(`    sesiones            ${totalSesiones}`);
console.log(`    ciclos / bonos      ${totalCiclos}`);
console.log(`    facturado en sesiones ${eur(totalFacturado)}`);

// ---------------------------------------------------------------------------
// 3. Aplicar, con copia antes
// ---------------------------------------------------------------------------

if (!APLICAR) {
  console.log("\n---");
  console.log("No se ha escrito NADA. Para aplicarlo:");
  console.log("  node scripts/repartir-clientes.mjs --aplicar");
  await cliente.end();
  process.exit(0);
}

// La copia guarda el estado exacto de la columna antes de tocarla: con ella se
// vuelve atrás aunque se cierre todo.
const copias = path.join(AQUI, "..", ".copias");
await mkdir(copias, { recursive: true });
const sello = new Date().toISOString().replace(/[:.]/g, "-");
const ruta = path.join(copias, `entrenador-id-${sello}.json`);
await writeFile(
  ruta,
  JSON.stringify(filas.map((f) => ({ id: f.id, entrenador_id: f.entrenador_id })), null, 2),
  "utf8",
);
console.log(`\n  Copia guardada en: ${ruta}`);

const antes = {
  sesiones: totalSesiones,
  ciclos: totalCiclos,
  facturado: Math.round(totalFacturado * 100),
};

await cliente.query("begin");
try {
  const r = await cliente.query("update clientes set entrenador_id = $1 where entrenador_id is null", [
    admin.id,
  ]);

  const ahora = (
    await cliente.query(`
      select (select count(*)::int from sesiones) as sesiones,
             (select count(*)::int from ciclos) as ciclos,
             coalesce((select sum(tarifa) from sesiones), 0)::float as facturado`)
  ).rows[0];

  const igual =
    ahora.sesiones === antes.sesiones &&
    ahora.ciclos === antes.ciclos &&
    Math.round(ahora.facturado * 100) === antes.facturado;

  if (!igual) throw new Error("Algo más ha cambiado. Se deshace todo.");

  await cliente.query("commit");
  console.log(`\n  ✓ ${r.rowCount} clientes asignados a «${admin.nombre}».`);
  console.log(`  ✓ Sesiones, ciclos y facturación sin un solo cambio.`);
  console.log(`\n  Para volver atrás: node scripts/repartir-clientes.mjs --deshacer ${path.basename(ruta)}`);
} catch (error) {
  await cliente.query("rollback");
  console.log(`\n  ✗ No se ha aplicado nada: ${error.message}`);
  process.exitCode = 1;
}

await cliente.end();
