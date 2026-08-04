/**
 * Compara origen y destino campo a campo, DESPUÉS de migrar.
 *
 *   node scripts/comparar.mjs <copia.db>
 *
 * Es una segunda opinión, escrita aparte del script de migración a propósito:
 * si los dos usaran el mismo código para leer, un error de lectura se colaría
 * en los dos lados y nadie lo vería.
 *
 * No escribe nada nunca.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import pg from "pg";

pg.types.setTypeParser(1082, (v) => v);

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ORIGEN = process.argv[2];
if (!ORIGEN) {
  console.error("\n  Uso: node scripts/comparar.mjs <copia.db>\n");
  process.exit(1);
}

const env = Object.fromEntries(
  (await readFile(path.join(AQUI, "..", ".env.local"), "utf8"))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const sqlite = new DatabaseSync(ORIGEN, { readOnly: true });
const bd = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await bd.connect();

const dif = [];
const anota = (que, a, b) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) dif.push(`${que}: origen ${JSON.stringify(a)} / destino ${JSON.stringify(b)}`);
};
const céntimos = (v) => Math.round(Number(v ?? 0) * 100);

// --- Clientes, uno a uno -----------------------------------------------------

const origenClientes = sqlite.prepare("select * from clientes order by nombre").all();
const { rows: destinoClientes } = await bd.query(`
  select c.*, m.nombre_origen from clientes c
    left join migracion_clientes m on m.cliente_id = c.id
   order by c.nombre`);

anota("número de clientes", origenClientes.length, destinoClientes.length);

for (const o of origenClientes) {
  const d = destinoClientes.find((x) => x.nombre_origen === o.nombre);
  if (!d) {
    dif.push(`«${o.nombre}» no está en el destino`);
    continue;
  }
  anota(`«${o.nombre}» · nombre`, o.nombre, d.nombre);
  // El token es lo que hace que su enlace y su QR sigan funcionando.
  anota(`«${o.nombre}» · token`, o.token, d.token);
  anota(`«${o.nombre}» · estado`, o.estado ?? "activo", d.estado);
  anota(`«${o.nombre}» · pendiente de pago`, Boolean(o.pendiente_pago), d.pendiente_pago);
  anota(`«${o.nombre}» · sesiones completadas`, o.sesiones_completadas ?? 0, Number(d.sesiones_completadas));
  anota(`«${o.nombre}» · ciclo actual`, o.ciclo_bono ?? 1, Number(d.ciclo_actual));
}

// --- Servicios ---------------------------------------------------------------

const origenCiclos = sqlite.prepare("select * from programas_cliente").all();
const { rows: destinoCiclos } = await bd.query(`
  select c.*, m.nombre_origen from ciclos c
    join migracion_clientes m on m.cliente_id = c.cliente_id`);

anota("número de servicios", origenCiclos.length, destinoCiclos.length);

for (const o of origenCiclos) {
  const d = destinoCiclos.find((x) => x.nombre_origen === o.cliente && Number(x.ciclo) === o.ciclo_bono);
  if (!d) {
    dif.push(`servicio ${o.ciclo_bono} de «${o.cliente}» no está en el destino`);
    continue;
  }
  const q = `«${o.cliente}» servicio ${o.ciclo_bono}`;
  anota(`${q} · modalidad`, o.modalidad ?? "bono", d.modalidad);
  anota(`${q} · tarifa`, céntimos(o.tarifa), céntimos(d.tarifa));
  anota(`${q} · sesiones`, o.sesiones_totales ?? 0, Number(d.sesiones_totales));
  anota(`${q} · precio total`, céntimos(o.precio_total), céntimos(d.precio_total));
  anota(`${q} · cuota`, céntimos(o.cuota_mensual), céntimos(d.cuota_mensual));
  anota(`${q} · fecha inicio`, o.fecha_inicio ?? null, d.fecha_inicio ?? null);
  anota(`${q} · fecha fin`, o.fecha_fin ?? null, d.fecha_fin ?? null);
  // El tri-estado: null es «no se sabe», y tiene que seguir siéndolo.
  const cobroOrigen = o.pagado === null || o.pagado === undefined ? null : Boolean(o.pagado);
  anota(`${q} · cobro`, cobroOrigen, d.pagado);
}

// --- Sesiones ----------------------------------------------------------------

const origenSesiones = sqlite.prepare("select * from historial_sesiones").all();
const { rows: destinoSesiones } = await bd.query(`
  select s.*, m.nombre_origen from sesiones s
    join migracion_clientes m on m.cliente_id = s.cliente_id`);

anota("número de sesiones", origenSesiones.length, destinoSesiones.length);
anota(
  "dinero de las sesiones (céntimos)",
  origenSesiones.reduce((s, x) => s + céntimos(x.tarifa), 0),
  destinoSesiones.reduce((s, x) => s + céntimos(x.tarifa), 0),
);
anota(
  "sesiones sin importe",
  origenSesiones.filter((x) => x.tarifa === null).length,
  destinoSesiones.filter((x) => x.tarifa === null).length,
);

// Cliente a cliente y fecha a fecha, para que un descuadre diga dónde está.
for (const o of origenClientes) {
  const suyasOrigen = origenSesiones.filter((s) => s.cliente === o.nombre);
  const suyasDestino = destinoSesiones.filter((s) => s.nombre_origen === o.nombre);
  anota(`«${o.nombre}» · nº de sesiones`, suyasOrigen.length, suyasDestino.length);
  anota(
    `«${o.nombre}» · dinero`,
    suyasOrigen.reduce((s, x) => s + céntimos(x.tarifa), 0),
    suyasDestino.reduce((s, x) => s + céntimos(x.tarifa), 0),
  );
  anota(
    `«${o.nombre}» · fechas`,
    suyasOrigen.map((s) => s.fecha).sort(),
    suyasDestino.map((s) => s.fecha).sort(),
  );
  anota(
    `«${o.nombre}» · números de sesión`,
    suyasOrigen.map((s) => s.numero_sesion).sort((a, b) => a - b),
    suyasDestino.map((s) => Number(s.numero_sesion)).sort((a, b) => a - b),
  );
}

// --- Lo demás ----------------------------------------------------------------

for (const [que, tablaOrigen, tablaDestino] of [
  ["cuotas mensuales", "cargos_mensuales", "cargos_mensuales"],
  ["clases de grupo", "clases_grupo", "clases_grupo"],
  ["facturación Kids", "facturacion_kids_mensual", "facturacion_kids_mensual"],
  ["ajustes", "ajustes_mensuales", "ajustes_mensuales"],
]) {
  const a = sqlite.prepare(`select count(*) as n from ${tablaOrigen}`).get().n;
  const { rows } = await bd.query(`select count(*)::int as n from ${tablaDestino}`);
  anota(`número de ${que}`, a, rows[0].n);
}

// --- Informe -----------------------------------------------------------------

sqlite.close();
await bd.end();

console.log(`\n  Comparación campo a campo: ${ORIGEN}\n`);
if (dif.length === 0) {
  console.log("  ✓ Sin diferencias. Clientes, servicios, sesiones, importes, cobros y TOKENS coinciden.\n");
  process.exit(0);
}
console.error(`  ✗ ${dif.length} diferencia(s):\n`);
for (const d of dif) console.error(`    · ${d}`);
console.error("");
process.exit(1);
