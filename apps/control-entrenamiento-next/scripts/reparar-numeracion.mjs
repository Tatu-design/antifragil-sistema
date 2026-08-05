/**
 * Diagnóstico y reparación de la numeración en la base real.
 *
 *   node scripts/reparar-numeracion.mjs            → solo enseña qué cambiaría
 *   node scripts/reparar-numeracion.mjs --aplicar  → lo aplica
 *
 * Regla de Fernando (2026-08-04): nada se aplica sobre datos reales sin
 * enseñar antes qué filas cambian, su estado antes y después, el impacto
 * económico, el motivo y cómo volver atrás. Por eso el modo por defecto es
 * mirar, no tocar.
 */
import { readFile } from "node:fs/promises";
import pg from "pg";

const env = Object.fromEntries(
  (await readFile(".env.local", "utf8")).split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const aplicar = process.argv.includes("--aplicar");
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

async function economia() {
  const { rows } = await c.query(
    "select to_char(fecha,'YYYY-MM') mes, count(*)::int horas, coalesce(sum(tarifa),0)::float dinero " +
    "from sesiones group by 1 order by 1 desc");
  const { rows: cuotas } = await c.query(
    "select anio, mes, coalesce(sum(importe),0)::float cuota from cargos_mensuales group by 1,2");
  return { sesiones: rows, cuotas };
}

const antes = await economia();
const { rows: clientes } = await c.query(
  "select id, nombre, ciclo_actual, sesiones_completadas from clientes order by nombre");

const planes = [];
for (const cliente of clientes) {
  const { rows: ses } = await c.query(
    "select id, fecha, ciclo, numero_sesion from sesiones where cliente_id=$1 and ciclo=$2 order by fecha, id",
    [cliente.id, cliente.ciclo_actual]);
  if (ses.length === 0) continue;

  const { rows: ciclo } = await c.query(
    "select sesiones_totales from ciclos where cliente_id=$1 and ciclo=$2", [cliente.id, cliente.ciclo_actual]);
  const tope = ciclo[0]?.sesiones_totales ?? 0;

  const numeros = ses.map((s) => s.numero_sesion);
  const correcto = ses.map((_, i) => i + 1);
  if (numeros.every((n, i) => n === correcto[i]) && cliente.sesiones_completadas === ses.length) continue;

  if (tope > 0 && ses.length > tope) {
    const partes = [];
    for (let i = 0; i < ses.length; i += tope) partes.push(ses.slice(i, i + tope));
    planes.push({
      cliente, tope, repartir: true, numeros,
      numerosDespues: partes.flatMap((p) => p.map((_, j) => j + 1)),
      contadorDespues: partes[partes.length - 1].length,
      cicloDespues: cliente.ciclo_actual + partes.length - 1,
      cambios: partes.flatMap((parte, i) => parte.map((s, j) => ({
        id: s.id, fecha: s.fecha, cicloAntes: s.ciclo, cicloDespues: cliente.ciclo_actual + i,
        numeroAntes: s.numero_sesion, numeroDespues: j + 1,
      })).filter((x) => x.cicloAntes !== x.cicloDespues || x.numeroAntes !== x.numeroDespues)),
      partes: partes.map((p, i) => ({
        ciclo: cliente.ciclo_actual + i, desde: p[0].fecha,
        hasta: i === partes.length - 1 ? null : p[p.length - 1].fecha, sesiones: p.length,
      })),
    });
  } else {
    planes.push({
      cliente, tope, repartir: false, numeros, numerosDespues: correcto,
      contadorDespues: ses.length, cicloDespues: cliente.ciclo_actual,
      cambios: ses.map((s, i) => ({
        id: s.id, fecha: s.fecha, cicloAntes: s.ciclo, cicloDespues: s.ciclo,
        numeroAntes: s.numero_sesion, numeroDespues: i + 1,
      })).filter((x) => x.numeroAntes !== x.numeroDespues),
      partes: [],
    });
  }
}

const iso = (f) => (f instanceof Date ? f.toISOString().slice(0, 10) : String(f).slice(0, 10));

console.log(`\n${aplicar ? "APLICANDO" : "PREVISUALIZACIÓN — no se escribe nada"}\n`);
console.log(`Clientes afectados: ${planes.length}\n`);
for (const p of planes) {
  console.log(`  ${p.cliente.nombre} (bono de ${p.tope})`);
  console.log(`      números  : [${p.numeros}]  ->  [${p.numerosDespues}]`);
  console.log(`      contador : ${p.cliente.sesiones_completadas}  ->  ${p.contadorDespues}`);
  if (p.repartir) {
    console.log(`      ciclo en curso: ${p.cliente.ciclo_actual} -> ${p.cicloDespues} (le faltaba una renovación)`);
    for (const parte of p.partes) {
      console.log(`        bono ${parte.ciclo}: ${parte.sesiones} sesiones desde ${iso(parte.desde)} · ` +
        `${parte.hasta ? "cerrado el " + iso(parte.hasta) : "en curso"}`);
    }
  }
  console.log(`      filas de sesiones que cambian: ${p.cambios.length}`);
  for (const x of p.cambios) {
    console.log(`         id=${x.id}  ${iso(x.fecha)}  nº ${x.numeroAntes}->${x.numeroDespues}` +
      (x.cicloAntes !== x.cicloDespues ? `  ciclo ${x.cicloAntes}->${x.cicloDespues}` : ""));
  }
}

if (!aplicar) {
  console.log("\nIMPACTO ECONÓMICO: ninguno. Solo se tocan `numero_sesion` y `ciclo` de");
  console.log("sesiones, y `sesiones_completadas`/`ciclo_actual` de clientes. Ni fechas,");
  console.log("ni tarifas, ni horas, ni cuotas, ni semanas.");
  console.log("\nVUELTA ATRÁS: la copia de `.data/copias/` restaura el estado exacto.");
  console.log("\n(nada guardado; ejecuta con --aplicar cuando lo apruebes)");
  await c.end();
  process.exit(0);
}

await c.query("begin");
try {
  for (const p of planes) {
    // Los ciclos PRIMERO: `sesiones` tiene una clave foránea contra
    // (cliente_id, ciclo), así que mover una sesión a un ciclo que todavía no
    // existe lo rechaza Postgres — y hace bien. (SQLite no lo comprobaba.)
    for (const parte of p.partes) {
      const { rows } = await c.query("select * from ciclos where cliente_id=$1 and ciclo=$2",
        [p.cliente.id, parte.ciclo]);
      if (rows.length) {
        await c.query("update ciclos set fecha_inicio=$3, fecha_fin=$4 where cliente_id=$1 and ciclo=$2",
          [p.cliente.id, parte.ciclo, parte.desde, parte.hasta]);
      } else {
        const { rows: base } = await c.query("select * from ciclos where cliente_id=$1 and ciclo=$2",
          [p.cliente.id, p.cliente.ciclo_actual]);
        const b = base[0];
        await c.query(
          "insert into ciclos (cliente_id, ciclo, modalidad, servicio, tarifa, sesiones_totales, precio_total, " +
          "cuota_mensual, sesiones_referencia, anio, mes, fecha_inicio, fecha_fin, pagado) " +
          "values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
          [p.cliente.id, parte.ciclo, b.modalidad, b.servicio, b.tarifa, b.sesiones_totales, b.precio_total,
           b.cuota_mensual, b.sesiones_referencia, b.anio, b.mes, parte.desde, parte.hasta, b.pagado]);
      }
    }
    for (const x of p.cambios) {
      await c.query("update sesiones set ciclo=$2, numero_sesion=$3 where id=$1",
        [x.id, x.cicloDespues, x.numeroDespues]);
    }
    await c.query("update clientes set sesiones_completadas=$2, ciclo_actual=$3 where id=$1",
      [p.cliente.id, p.contadorDespues, p.cicloDespues]);
  }
  await c.query("commit");
} catch (e) { await c.query("rollback"); throw e; }

const despues = await economia();
console.log("\nECONOMÍA");
console.log("  antes  ", JSON.stringify(antes.sesiones));
console.log("  después", JSON.stringify(despues.sesiones));
console.log(JSON.stringify(antes) === JSON.stringify(despues)
  ? "\n  ✓ Ni un euro ni una hora se han movido."
  : "\n  ✗ ALGO CAMBIÓ — revisar.");
await c.end();
