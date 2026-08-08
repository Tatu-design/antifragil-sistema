import { readFile } from "node:fs/promises";
import pg from "pg";
const env = Object.fromEntries(
  (await readFile(".env.local", "utf8")).split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows } = await c.query(`
  select s.numero_sesion, to_char(s.fecha,'YYYY-MM-DD') fecha, to_char(s.fecha,'Dy') dia, s.tarifa, s.ciclo
    from sesiones s join clientes c on c.id = s.cliente_id
   where c.nombre='Nikki' order by s.ciclo, s.numero_sesion`);
console.log("SESIONES DE NIKKI (fechas leídas como texto, sin conversiones)\n");
for (const s of rows) console.log(`  ciclo ${s.ciclo}  nº${String(s.numero_sesion).padStart(2)}  ${s.fecha}  ${s.dia}  ${s.tarifa} €`);
const { rows: ci } = await c.query(`
  select ci.ciclo, to_char(ci.fecha_inicio,'YYYY-MM-DD') desde, to_char(ci.fecha_fin,'YYYY-MM-DD') hasta, ci.pagado
    from ciclos ci join clientes c on c.id = ci.cliente_id where c.nombre='Nikki' order by ci.ciclo`);
console.log("\nBONOS");
for (const x of ci) console.log(`  bono ${x.ciclo}: ${x.desde ?? "sin sesiones"} → ${x.hasta ?? "en curso"} · ${x.pagado ? "pagado" : "PENDIENTE DE PAGO"}`);
const { rows: j } = await c.query("select count(*)::int h, coalesce(sum(tarifa),0)::float d from sesiones where to_char(fecha,'YYYY-MM')='2026-07'");
console.log(`\nJULIO: ${j[0].d.toFixed(2)} € · ${j[0].h} h`);
await c.end();
