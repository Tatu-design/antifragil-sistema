import { readFile } from "node:fs/promises";
import pg from "pg";
const env = Object.fromEntries(
  (await readFile(".env.local", "utf8")).split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows } = await c.query(`
  select cl.nombre, cl.ciclo_actual, ci.ciclo, ci.modalidad, ci.servicio, ci.tarifa,
         ci.sesiones_totales, ci.cuota_mensual, ci.fecha_inicio, ci.fecha_fin, ci.pagado,
         (select count(*)::int from sesiones s where s.cliente_id=ci.cliente_id and s.ciclo=ci.ciclo) n,
         (select coalesce(sum(tarifa),0)::float from sesiones s where s.cliente_id=ci.cliente_id and s.ciclo=ci.ciclo) dinero
    from ciclos ci join clientes cl on cl.id = ci.cliente_id
   order by cl.nombre, ci.ciclo`);

const porCliente = new Map();
for (const r of rows) {
  if (!porCliente.has(r.nombre)) porCliente.set(r.nombre, []);
  porCliente.get(r.nombre).push(r);
}

console.log("CLIENTES QUE HAN CAMBIADO DE MODALIDAD");
console.log("(su historial mezcla un bono viejo con la modalidad nueva)\n");
for (const [nombre, ciclos] of porCliente) {
  const modalidades = new Set(ciclos.map((x) => x.modalidad));
  if (modalidades.size < 2) continue;
  console.log(`  ${nombre}`);
  for (const x of ciclos) {
    const f = (d) => (d ? String(new Date(d).toISOString().slice(0, 10)) : "—");
    console.log(`     ciclo ${x.ciclo}: ${x.modalidad.toUpperCase().padEnd(11)} «${x.servicio}» · ` +
      `${x.n} sesiones · facturó ${x.dinero.toFixed(2)} € · ${f(x.fecha_inicio)} → ${f(x.fecha_fin)} · ` +
      `${x.pagado ? "pagado" : "pendiente"}`);
  }
  console.log("");
}
await c.end();
