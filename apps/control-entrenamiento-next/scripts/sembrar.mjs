/**
 * Pone datos FICTICIOS de prueba en Supabase.
 *
 *   npm run supabase:sembrar
 *
 * Los mismos cinco clientes de mentira que usa el repositorio de staging, para
 * poder comparar que las dos implementaciones se comportan igual.
 *
 * NUNCA toca datos reales: borra y rehace solo estas filas de prueba, y se
 * niega a funcionar si encuentra clientes que no reconoce.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

const FICTICIOS = [
  "Cliente A",
  "Cliente A renombrado", // lo deja la prueba de renombrado
  "Cliente B",
  "Pareja C",
  "Cliente D",
  "Cliente E",
];

const env = Object.fromEntries(
  (await readFile(path.join(AQUI, "..", ".env.local"), "utf8"))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const cliente = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await cliente.connect();

try {
  // Salvaguarda: si aparece alguien que no está en la lista de ficticios, es
  // que esta base ya tiene datos de verdad. Mejor parar que arriesgarse.
  const otros = await cliente.query(
    `select nombre from clientes where nombre <> all($1::text[])`,
    [FICTICIOS],
  );
  if (otros.rowCount > 0) {
    console.error(
      `\n  ✗ Hay clientes que no son de prueba: ${otros.rows.map((f) => f.nombre).join(", ")}` +
        "\n    No siembro nada para no tocar datos reales.\n",
    );
    process.exit(1);
  }

  await cliente.query("begin");
  await cliente.query("delete from clientes where nombre = any($1::text[])", [FICTICIOS]);
  await cliente.query("delete from semanas");

  // Cinco clientes que cubren los tres tipos de servicio y los tres estados.
  const ids = {};
  for (const [nombre, estado, pendiente, hechas, token] of [
    ["Cliente A", "activo", false, 6, "tok-cliente-a"],
    ["Cliente B", "activo", true, 0, "tok-cliente-b"],
    ["Pareja C", "activo", false, 3, "tok-pareja-c"],
    ["Cliente D", "activo", false, 0, "tok-cliente-d"],
    ["Cliente E", "pausado", false, 2, "tok-cliente-e"],
  ]) {
    const r = await cliente.query(
      `insert into clientes (nombre, estado, token, pendiente_pago, sesiones_completadas, ciclo_actual)
       values ($1,$2,$3,$4,$5,1) returning id`,
      [nombre, estado, token, pendiente, hechas],
    );
    ids[nombre] = r.rows[0].id;
  }

  //                nombre        modalidad      servicio            tarifa sesiones total cuota  ref  anio  mes  inicio        pagado
  const ciclos = [
    ["Cliente A", "bono",        "Bono 8 sesiones",  45,   8,  360,  null, null, null, null, "2026-07-13", true],
    ["Cliente B", "mensualidad", "Mensualidad",      null, 0,  null, 720,  12,   2026, 8,    null,         false],
    ["Pareja C",  "bono",        "Bono pareja 10",   60,  10,  600,  null, null, null, null, "2026-07-20", true],
    ["Cliente D", "cuenta",      "Cuenta de cliente",35,   0,  null, null, null, 2026, 8,    null,         false],
    ["Cliente E", "bono",        "Bono 4 sesiones",  50,   4,  200,  null, null, null, null, "2026-06-15", true],
  ];
  for (const [nombre, modalidad, servicio, tarifa, totales, precio, cuota, ref, anio, mes, inicio, pagado] of ciclos) {
    await cliente.query(
      `insert into ciclos (cliente_id, ciclo, modalidad, servicio, tarifa, sesiones_totales,
                           precio_total, cuota_mensual, sesiones_referencia, anio, mes, fecha_inicio, pagado)
       values ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [ids[nombre], modalidad, servicio, tarifa, totales, precio, cuota, ref, anio, mes, inicio, pagado],
    );
  }

  await cliente.query(
    `insert into cargos_mensuales (cliente_id, anio, mes, concepto, ciclo, importe, pagado)
     values ($1, 2026, 8, 'mensualidad', 1, 720, false)`,
    [ids["Cliente B"]],
  );

  // Historial: sesiones ya hechas, con su tarifa congelada.
  const sesiones = [
    ["Cliente A", ["2026-07-13", "2026-07-15", "2026-07-20", "2026-07-22", "2026-07-27", "2026-07-29"], 8, 45, "Bono 8 sesiones"],
    ["Pareja C", ["2026-07-20", "2026-07-23", "2026-07-27"], 10, 60, "Bono pareja 10"],
    ["Cliente E", ["2026-06-15", "2026-06-17"], 4, 50, "Bono 4 sesiones"],
  ];
  for (const [nombre, fechas, totales, tarifa, servicio] of sesiones) {
    for (const [i, f] of fechas.entries()) {
      await cliente.query(
        `insert into sesiones (cliente_id, ciclo, fecha, hora, numero_sesion, sesiones_totales, tarifa, servicio)
         values ($1,1,$2,'10:00',$3,$4,$5,$6)`,
        [ids[nombre], f, i + 1, totales, tarifa, servicio],
      );
    }
  }

  // La economía semanal se calcula desde las sesiones, no se inventa.
  await cliente.query(`
    insert into semanas (inicio, fin, facturacion, horas, horas_sin_importe)
    select semana, semana + 6,
           coalesce(sum(tarifa), 0),
           count(*) filter (where tarifa is not null),
           count(*) filter (where tarifa is null)
      from (select (fecha - ((extract(isodow from fecha)::int - 1) || ' days')::interval)::date as semana,
                   tarifa
              from sesiones) t
     group by semana`);

  await cliente.query("commit");

  const resumen = await cliente.query(`
    select (select count(*) from clientes)::int as clientes,
           (select count(*) from ciclos)::int as ciclos,
           (select count(*) from sesiones)::int as sesiones,
           (select count(*) from semanas)::int as semanas,
           (select count(*) from cargos_mensuales)::int as cargos`);
  const r = resumen.rows[0];
  console.log(
    `\n  ✓ Datos de prueba puestos: ${r.clientes} clientes, ${r.ciclos} servicios, ` +
      `${r.sesiones} sesiones, ${r.semanas} semanas, ${r.cargos} cuota(s).\n`,
  );
} catch (error) {
  await cliente.query("rollback").catch(() => {});
  console.error(`\n  ✗ ${error.message}\n`);
  process.exit(1);
} finally {
  await cliente.end();
}
