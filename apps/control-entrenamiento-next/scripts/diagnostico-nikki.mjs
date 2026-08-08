import { readFile } from "node:fs/promises";
import pg from "pg";
const env = Object.fromEntries(
  (await readFile(".env.local", "utf8")).split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows: cl } = await c.query("select * from clientes where nombre = 'Nikki'");
const n = cl[0];
const { rows: ciclos } = await c.query("select * from ciclos where cliente_id=$1 order by ciclo", [n.id]);
const { rows: ses } = await c.query(
  "select fecha, numero_sesion, tarifa from sesiones where cliente_id=$1 order by fecha", [n.id]);

const cic = ciclos[0];
console.log(`NIKKI — ${cic.servicio}: bono de ${cic.sesiones_totales} a ${cic.tarifa} €/sesión`);
console.log(`  contador: ${n.sesiones_completadas} de ${cic.sesiones_totales}   ·   ${cic.pagado ? "pagado" : "PENDIENTE DE PAGO"}\n`);
console.log("SESIONES YA REGISTRADAS");
const dias = ["do","lu","ma","mi","ju","vi","sá"];
for (const s of ses) {
  const f = new Date(s.fecha);
  console.log(`  nº${String(s.numero_sesion).padStart(2)}   ${String(s.fecha).slice(0,10)}  ${dias[f.getDay()]}   ${s.tarifa} €`);
}
console.log(`\n  FALTAN ${cic.sesiones_totales - ses.length} sesiones para completar el bono.`);

const { rows: julio } = await c.query(
  "select count(*)::int horas, coalesce(sum(tarifa),0)::float d from sesiones where to_char(fecha,'YYYY-MM')='2026-07'");
console.log(`\nJULIO AHORA MISMO: ${julio[0].d.toFixed(2)} € · ${julio[0].horas} h`);
console.log(`  de Nikki: ${ses.filter(s => String(s.fecha).slice(0,7)==='2026-07').length} sesiones`);
await c.end();
