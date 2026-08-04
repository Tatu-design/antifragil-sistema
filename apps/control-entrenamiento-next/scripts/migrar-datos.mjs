/**
 * Trae los datos de la aplicación Flask (SQLite) a Supabase.
 *
 *   node scripts/migrar-datos.mjs <copia.db>            → ensayo, no escribe
 *   node scripts/migrar-datos.mjs <copia.db> --aplicar  → escribe de verdad
 *
 * QUÉ GARANTIZA
 *
 * - **En seco por defecto.** Sin `--aplicar` no toca la base ni se conecta:
 *   lee, valida y enseña el informe. Escribir hay que pedirlo expresamente.
 * - **Se puede repetir.** Cada cliente se identifica por su nombre de origen
 *   en `migracion_clientes`; volver a ejecutarlo actualiza en vez de duplicar.
 * - **Los tokens se copian tal cual.** Hay códigos QR repartidos entre los
 *   clientes: regenerarlos los rompería.
 * - **`pagado = null` sigue siendo «no se sabe»**, nunca «sin pagar».
 * - **Comprueba antes de dar nada por bueno**: recuentos, dinero y horas,
 *   origen contra destino. Una diferencia sin explicar es un fallo.
 *
 * NUNCA toca el archivo de origen: lo abre en modo solo lectura.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import pg from "pg";

pg.types.setTypeParser(1082, (v) => v);

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const APLICAR = process.argv.includes("--aplicar");
/** Borra lo que haya en el destino que NO venga de una migración anterior
 *  (los datos de demostración). Sin esto, mezclar los dos daría cifras que no
 *  cuadran con el origen — y el script se negaría, con razón. */
const LIMPIAR = process.argv.includes("--limpiar");
const ORIGEN = process.argv[2];

function abortar(mensaje, ayuda) {
  console.error(`\n  ✗ ${mensaje}`);
  if (ayuda) console.error(`    ${ayuda}`);
  console.error("");
  process.exit(1);
}

if (!ORIGEN || ORIGEN.startsWith("--")) {
  abortar("Falta el archivo de origen.", "Uso: node scripts/migrar-datos.mjs <copia.db> [--aplicar]");
}

const env = Object.fromEntries(
  (await readFile(path.join(AQUI, "..", ".env.local"), "utf8"))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

let sqlite;
try {
  sqlite = new DatabaseSync(ORIGEN, { readOnly: true });
} catch (error) {
  abortar(
    `No se ha podido abrir «${ORIGEN}»: ${error.message}`,
    "Revisa la ruta. Tiene que ser una COPIA, nunca el archivo de producción.",
  );
}

/** La conexión se abre solo si hay que escribir: un ensayo tiene que poder
 *  hacerse sin base de datos delante, que es cuando más falta hace. */
let destino = null;
async function conectar() {
  destino = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await destino.connect();
}

const leer = (sql) => sqlite.prepare(sql).all();
const euros = (v) => (Math.round(v * 100) / 100).toFixed(2);

// ---------------------------------------------------------------------------
// 1 · Leer y validar el origen
// ---------------------------------------------------------------------------

console.log(`\n  Origen: ${ORIGEN}`);
console.log(APLICAR ? "  Modo: APLICAR (va a escribir)\n" : "  Modo: ensayo (no escribe nada)\n");

let clientes, ciclos, sesiones, cargos, clases, kids, ajustes;
try {
  clientes = leer("select * from clientes order by nombre");
  ciclos = leer("select * from programas_cliente order by cliente, ciclo_bono");
  sesiones = leer("select * from historial_sesiones order by cliente, fecha, id");
  cargos = leer("select * from cargos_mensuales");
  clases = leer("select * from clases_grupo");
  kids = leer("select * from facturacion_kids_mensual");
  ajustes = leer("select * from ajustes_mensuales");
} catch (error) {
  abortar(
    `Ese archivo no tiene la forma esperada: ${error.message}`,
    "¿Seguro que es una copia de la base de datos de la aplicación?",
  );
}

const problemas = [];
const nombres = new Set(clientes.map((c) => c.nombre));

// Una sesión sin su cliente no se puede migrar sin inventarse algo.
for (const s of sesiones) {
  if (!nombres.has(s.cliente)) problemas.push(`La sesión ${s.id} apunta a «${s.cliente}», que no existe`);
}
for (const c of ciclos) {
  if (!nombres.has(c.cliente)) problemas.push(`Hay un servicio de «${c.cliente}», que no existe`);
}
for (const c of clientes) {
  if (!c.token) problemas.push(`«${c.nombre}» no tiene enlace: el suyo dejaría de funcionar`);
}

if (problemas.length) {
  console.error("  ✗ El origen tiene problemas y no se migra:\n");
  for (const p of problemas) console.error(`    · ${p}`);
  console.error("");
  process.exit(1);
}

const dineroOrigen = sesiones.reduce((s, x) => s + (x.tarifa ?? 0), 0);
const horasOrigen = sesiones.length;

console.log("  Lo que hay en el origen:");
console.log(`    clientes            ${clientes.length}`);
console.log(`    servicios           ${ciclos.length}`);
console.log(`    sesiones            ${sesiones.length}`);
console.log(`    cuotas mensuales    ${cargos.length}`);
console.log(`    clases de grupo     ${clases.length}`);
console.log(`    facturación Kids    ${kids.length}`);
console.log(`    ajustes             ${ajustes.length}`);
console.log(`    dinero en sesiones  ${euros(dineroOrigen)} €`);
console.log(`    horas               ${horasOrigen}`);

if (!APLICAR) {
  console.log("\n  Ensayo terminado. Nada se ha escrito.");
  console.log(`  Para migrar de verdad:  node scripts/migrar-datos.mjs ${ORIGEN} --aplicar\n`);
  sqlite.close();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 2 · Escribir, todo dentro de una transacción
// ---------------------------------------------------------------------------

await conectar();

const idDe = {};
try {
  await destino.query("begin");

  // Antes de nada: ¿hay en el destino clientes que no vengan de una migración?
  const ajenos = await destino.query(
    `select nombre from clientes
      where id not in (select cliente_id from migracion_clientes)`,
  );
  if (ajenos.rowCount && !LIMPIAR) {
    await destino.query("rollback");
    console.error("\n  ✗ El destino tiene clientes que no vienen del origen:");
    for (const f of ajenos.rows) console.error(`    · ${f.nombre}`);
    console.error("\n    Mezclarlos daría cifras que no cuadran. Para retirarlos antes de migrar:");
    console.error(`    node scripts/migrar-datos.mjs ${ORIGEN} --aplicar --limpiar\n`);
    sqlite.close();
    await destino.end();
    process.exit(1);
  }
  if (ajenos.rowCount) {
    console.log(`\n  Se retiran ${ajenos.rowCount} cliente(s) de demostración del destino.`);
    await destino.query(
      "delete from clientes where id not in (select cliente_id from migracion_clientes)",
    );
    await destino.query("delete from clases_grupo");
    await destino.query("delete from facturacion_kids_mensual");
    await destino.query("delete from ajustes_mensuales");
  }

  for (const c of clientes) {
    // La correspondencia por nombre de origen es lo que permite repetirlo sin
    // duplicar, y lo que hace la migración auditable y reversible.
    const previo = await destino.query(
      "select cliente_id from migracion_clientes where nombre_origen = $1",
      [c.nombre],
    );

    if (previo.rowCount) {
      idDe[c.nombre] = previo.rows[0].cliente_id;
      await destino.query(
        `update clientes set nombre = $2, estado = $3, pendiente_pago = $4,
                sesiones_completadas = $5, ciclo_actual = $6 where id = $1`,
        [
          idDe[c.nombre], c.nombre, c.estado ?? "activo", Boolean(c.pendiente_pago),
          c.sesiones_completadas ?? 0, c.ciclo_bono ?? 1,
        ],
      );
    } else {
      const r = await destino.query(
        `insert into clientes (nombre, estado, token, pendiente_pago, sesiones_completadas, ciclo_actual)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [
          // El token se copia TAL CUAL: hay QR repartidos.
          c.nombre, c.estado ?? "activo", c.token, Boolean(c.pendiente_pago),
          c.sesiones_completadas ?? 0, c.ciclo_bono ?? 1,
        ],
      );
      idDe[c.nombre] = r.rows[0].id;
      await destino.query(
        "insert into migracion_clientes (nombre_origen, cliente_id) values ($1,$2)",
        [c.nombre, idDe[c.nombre]],
      );
    }
  }

  // Lo que cuelga del cliente se rehace desde cero: así repetirlo no acumula.
  for (const id of Object.values(idDe)) {
    await destino.query("delete from sesiones where cliente_id = $1", [id]);
    await destino.query("delete from cargos_mensuales where cliente_id = $1", [id]);
    await destino.query("delete from ciclos where cliente_id = $1", [id]);
  }

  for (const c of ciclos) {
    await destino.query(
      `insert into ciclos (cliente_id, ciclo, modalidad, servicio, tarifa, sesiones_totales,
                           precio_total, cuota_mensual, sesiones_referencia, anio, mes,
                           fecha_inicio, fecha_fin, pagado)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        idDe[c.cliente], c.ciclo_bono, c.modalidad ?? "bono", c.tipo_programa,
        c.tarifa, c.sesiones_totales ?? 0, c.precio_total, c.cuota_mensual,
        c.sesiones_referencia, c.anio, c.mes, c.fecha_inicio, c.fecha_fin,
        // `null` sigue siendo «no se sabe». No se convierte en «sin pagar».
        c.pagado === null || c.pagado === undefined ? null : Boolean(c.pagado),
      ],
    );
  }

  for (const s of sesiones) {
    await destino.query(
      `insert into sesiones (cliente_id, ciclo, fecha, hora, numero_sesion,
                             sesiones_totales, tarifa, servicio)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        idDe[s.cliente], s.ciclo_bono ?? 1, s.fecha, s.hora, s.numero_sesion,
        s.sesiones_totales ?? 0, s.tarifa, s.tipo_programa,
      ],
    );
  }

  for (const c of cargos) {
    await destino.query(
      `insert into cargos_mensuales (cliente_id, anio, mes, concepto, ciclo, importe, pagado)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (cliente_id, anio, mes, concepto) do update set
         importe = excluded.importe, pagado = excluded.pagado`,
      [idDe[c.cliente], c.anio, c.mes, c.concepto ?? "mensualidad", c.ciclo, c.importe, Boolean(c.pagado)],
    );
  }

  await destino.query("delete from clases_grupo");
  for (const c of clases) {
    await destino.query("insert into clases_grupo (fecha, tipo) values ($1,$2)", [c.fecha, c.tipo]);
  }

  for (const k of kids) {
    await destino.query(
      `insert into facturacion_kids_mensual (anio, mes, importe) values ($1,$2,$3)
       on conflict (anio, mes) do update set importe = excluded.importe`,
      [k.anio, k.mes, k.importe],
    );
  }

  for (const a of ajustes) {
    await destino.query(
      `insert into ajustes_mensuales (anio, mes, origen, importe, horas, motivo)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (anio, mes, origen) do update set
         importe = excluded.importe, horas = excluded.horas, motivo = excluded.motivo`,
      [a.anio, a.mes, a.origen ?? "legacy", a.importe, a.horas, a.motivo],
    );
  }

  // La economía semanal se RECALCULA desde las sesiones, no se copia: así no
  // se arrastra ningún descuadre que pudiera venir del origen.
  await destino.query("delete from semanas");
  await destino.query(`
    insert into semanas (inicio, fin, facturacion, horas, horas_sin_importe)
    select semana, semana + 6,
           coalesce(sum(tarifa), 0),
           count(*) filter (where tarifa is not null),
           count(*) filter (where tarifa is null)
      from (select (fecha - ((extract(isodow from fecha)::int - 1) || ' days')::interval)::date as semana,
                   tarifa from sesiones) t
     group by semana`);
  await destino.query(`
    insert into semanas (inicio, fin, facturacion, horas, horas_sin_importe)
    select semana, semana + 6, count(*) * 15, count(*), 0
      from (select (fecha - ((extract(isodow from fecha)::int - 1) || ' days')::interval)::date as semana
              from clases_grupo where tipo = 'lidomare') t
     group by semana
    on conflict (inicio) do update set
      facturacion = semanas.facturacion + excluded.facturacion,
      horas = semanas.horas + excluded.horas`);

  await destino.query("commit");
} catch (error) {
  await destino.query("rollback").catch(() => undefined);
  console.error(`\n  ✗ La migración ha fallado y se ha deshecho entera:`);
  console.error(`    ${error.message}\n`);
  sqlite.close();
  await destino.end();
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3 · Comprobar que el destino dice lo mismo
// ---------------------------------------------------------------------------

const r = await destino.query(`
  select (select count(*)::int from clientes) as clientes,
         (select count(*)::int from ciclos) as ciclos,
         (select count(*)::int from sesiones) as sesiones,
         (select count(*)::int from cargos_mensuales) as cargos,
         (select count(*)::int from clases_grupo) as clases,
         (select coalesce(sum(tarifa),0) from sesiones) as dinero`);
const d = r.rows[0];

const comprobaciones = [
  ["clientes", clientes.length, Number(d.clientes)],
  ["servicios", ciclos.length, Number(d.ciclos)],
  ["sesiones", sesiones.length, Number(d.sesiones)],
  ["cuotas", cargos.length, Number(d.cargos)],
  ["clases de grupo", clases.length, Number(d.clases)],
  ["horas", horasOrigen, Number(d.sesiones)],
  // Al céntimo: comparar en euros con decimales es pedir un falso negativo.
  ["dinero (céntimos)", Math.round(dineroOrigen * 100), Math.round(Number(d.dinero) * 100)],
];

console.log("\n  Comprobación origen → destino:\n");
let fallos = 0;
for (const [que, origen, dest] of comprobaciones) {
  const bien = origen === dest;
  if (!bien) fallos += 1;
  console.log(`    ${bien ? "✓" : "✗"} ${que.padEnd(20)} ${origen} / ${dest}`);
}

sqlite.close();
await destino.end();

if (fallos) {
  console.error(`\n  ✗ ${fallos} diferencia(s) sin explicar. NO se puede dar por buena.\n`);
  process.exit(1);
}
console.log("\n  ✓ Todo coincide. Migración correcta.\n");
