/**
 * Instalar y comprobar el esquema en Supabase, sin copiar y pegar SQL a mano.
 *
 *   npm run supabase:comprobar   → mira si la conexión y las tablas están bien
 *   npm run supabase:migrar      → instala el esquema (o lo deja como está)
 *
 * Lee `DATABASE_URL` de `.env.local`. No toca nunca SQLite ni PythonAnywhere.
 *
 * Es seguro repetirlo: cada migración corre dentro de una transacción y se
 * anota en la tabla `migraciones`. Lo ya aplicado se salta.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../../..");
const MIGRACIONES = path.join(RAIZ, "services", "supabase", "migrations");

// ---------------------------------------------------------------------------

function leerEnv() {
  return readFile(path.join(AQUI, "..", ".env.local"), "utf8")
    .then((texto) =>
      Object.fromEntries(
        texto
          .split("\n")
          .map((linea) => linea.trim())
          .filter((linea) => linea && !linea.startsWith("#") && linea.includes("="))
          .map((linea) => {
            const corte = linea.indexOf("=");
            return [linea.slice(0, corte).trim(), linea.slice(corte + 1).trim()];
          }),
      ),
    )
    .catch(() => ({}));
}

function aviso(mensaje) {
  console.log(`\n  ${mensaje}`);
}

function fallo(mensaje, ayuda) {
  console.error(`\n  ✗ ${mensaje}`);
  if (ayuda) console.error(`\n    ${ayuda}\n`);
  process.exit(1);
}

async function conectar(url) {
  const cliente = new pg.Client({
    connectionString: url,
    // Supabase exige conexión cifrada. El certificado lo firma una autoridad
    // que Node no trae de serie, así que se acepta explícitamente: la
    // conexión sigue yendo cifrada.
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await cliente.connect();
  return cliente;
}

// ---------------------------------------------------------------------------

async function comprobar(cliente) {
  const version = await cliente.query("select version()");
  aviso(`✓ Conectado a ${version.rows[0].version.split(",")[0]}`);

  const tablas = await cliente.query(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  const esperadas = [
    "cargos_mensuales",
    "ciclos",
    "clientes",
    "idempotencia",
    "migracion_clientes",
    "perfiles",
    "semanas",
    "sesiones",
  ];
  const hay = tablas.rows.map((f) => f.tablename);
  const faltan = esperadas.filter((t) => !hay.includes(t));

  if (hay.length === 0) {
    aviso("· La base de datos está vacía. Ejecuta:  npm run supabase:migrar");
    return false;
  }

  aviso(`✓ ${hay.length} tablas: ${hay.join(", ")}`);
  if (faltan.length) {
    aviso(`✗ Faltan: ${faltan.join(", ")} — ejecuta:  npm run supabase:migrar`);
    return false;
  }

  // Sin protección por fila, cualquiera con la clave pública leería todo.
  const sinRls = await cliente.query(
    `select tablename from pg_tables
      where schemaname = 'public' and rowsecurity = false order by tablename`,
  );
  if (sinRls.rows.length) {
    aviso(`✗ SIN protección de filas: ${sinRls.rows.map((f) => f.tablename).join(", ")}`);
    return false;
  }
  aviso("✓ Todas las tablas tienen protección de filas activa");

  const funcion = await cliente.query(
    `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'firmar_sesion'`,
  );
  aviso(funcion.rowCount ? "✓ La función firmar_sesion existe" : "✗ Falta la función firmar_sesion");

  const politicas = await cliente.query(`select count(*)::int as n from pg_policies where schemaname='public'`);
  aviso(`✓ ${politicas.rows[0].n} políticas de seguridad`);

  return faltan.length === 0 && sinRls.rows.length === 0 && funcion.rowCount > 0;
}

// ---------------------------------------------------------------------------

async function migrar(cliente) {
  await cliente.query(`
    create table if not exists public.migraciones (
      nombre    text primary key,
      aplicada  timestamptz not null default now()
    )`);

  const yaAplicadas = new Set(
    (await cliente.query("select nombre from public.migraciones")).rows.map((f) => f.nombre),
  );

  const archivos = (await readdir(MIGRACIONES)).filter((f) => f.endsWith(".sql")).sort();
  if (archivos.length === 0) fallo(`No hay migraciones en ${MIGRACIONES}`);

  let aplicadas = 0;
  for (const archivo of archivos) {
    if (yaAplicadas.has(archivo)) {
      aviso(`· ${archivo} — ya estaba`);
      continue;
    }

    const sql = await readFile(path.join(MIGRACIONES, archivo), "utf8");
    try {
      // Cada migración, entera o nada. Si falla a la mitad no deja medio
      // esquema instalado, que sería peor que no instalar nada.
      await cliente.query("begin");
      await cliente.query(sql);
      await cliente.query("insert into public.migraciones (nombre) values ($1)", [archivo]);
      await cliente.query("commit");
      aviso(`✓ ${archivo} — aplicada`);
      aplicadas += 1;
    } catch (error) {
      await cliente.query("rollback");
      console.error(`\n  ✗ ${archivo} ha fallado. No se ha aplicado nada de ese archivo.\n`);
      console.error(`    ${error.message}`);
      if (error.position) console.error(`    (posición ${error.position} del archivo)`);
      console.error("\n    Pásame este mensaje y lo corrijo.\n");
      process.exit(1);
    }
  }

  aviso(aplicadas ? `\n  ${aplicadas} migración(es) aplicadas.` : "\n  Todo estaba ya al día.");
}

// ---------------------------------------------------------------------------

const orden = process.argv[2] ?? "comprobar";
const env = await leerEnv();
const url = env.DATABASE_URL || process.env.DATABASE_URL;

if (!url) {
  fallo(
    "Falta DATABASE_URL en apps/control-entrenamiento-next/.env.local",
    "En Supabase: Project Settings → Database → Connection string → URI.\n" +
      "    Copia esa línea y sustituye [YOUR-PASSWORD] por la contraseña de la base de datos.",
  );
}
if (url.includes("[YOUR-PASSWORD]") || url.includes("[TU-CONTRASENA]")) {
  fallo(
    "DATABASE_URL todavía lleva el hueco de la contraseña sin rellenar",
    "Sustituye [YOUR-PASSWORD] por la contraseña que guardaste al crear el proyecto.",
  );
}

let cliente;
try {
  cliente = await conectar(url);
} catch (error) {
  fallo(
    `No se ha podido conectar: ${error.message}`,
    "Revisa que la contraseña dentro de DATABASE_URL sea la correcta y que no\n" +
      "    queden corchetes ni espacios. Si la contraseña lleva símbolos raros,\n" +
      "    dímelo y la codificamos.",
  );
}

try {
  if (orden === "migrar") {
    await migrar(cliente);
    aviso("\n  Comprobando cómo ha quedado…");
    await comprobar(cliente);
  } else {
    const bien = await comprobar(cliente);
    aviso(bien ? "\n  Todo correcto. Ya puedo seguir yo.\n" : "");
  }
} finally {
  await cliente.end();
}
