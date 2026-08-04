/**
 * Recorre las pantallas por HTTP de verdad y comprueba que salen con la misma
 * estructura que las plantillas de Flask. No mira estilos: mira que estén las
 * mismas clases y los mismos textos.
 *
 * Existe porque las 131 pruebas, los tipos y el build pasaban enteros con la
 * interfaz equivocada: nada de lo que medían miraba la pantalla (2026-08-04).
 * Comprueba también los archivos que cada pantalla necesita y que precargar
 * «Salir» no cierre la sesión — dos fallos reales que el HTML no delataba.
 *
 * Uso:
 *   node scripts/comprobar-pantallas.mjs                  (contra localhost:3111)
 *   BASE=https://…vercel.app node scripts/comprobar-pantallas.mjs
 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://127.0.0.1:3111";
const RAIZ = process.env.RAIZ ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(`${RAIZ}/.env.local`, "utf8");
const leer = (clave) => env.match(new RegExp(`^${clave}=(.*)$`, "m"))?.[1]?.trim();

const SECRETO = leer("SESSION_SECRET");
const contenido = Buffer.from(
  JSON.stringify({ correo: "pruebas@local.test", caduca: Date.now() + 600_000 }),
).toString("base64url");
const cookie = `af_sesion=${contenido}.${createHmac("sha256", SECRETO).update(contenido).digest("hex")}`;

const fallos = [];

async function traer(ruta, conSesion = true) {
  const r = await fetch(`${BASE}${ruta}`, {
    redirect: "manual",
    headers: conSesion ? { cookie } : {},
  });
  return { estado: r.status, html: await r.text(), destino: r.headers.get("location") };
}

function comprobar(nombre, html, esperados) {
  const faltan = esperados.filter((t) => !html.includes(t));
  if (faltan.length) {
    fallos.push(nombre);
    console.log(`  x ${nombre} -- faltan: ${faltan.join(" | ")}`);
  } else {
    console.log(`  ok ${nombre}`);
  }
}

// 1. Login -----------------------------------------------------------------
let r = await traer("/login", false);
comprobar("login", r.html, [
  'class="page sin-barra"',
  "logo-login",
  "para continuar",
  'class="formulario"',
  'class="campo"',
  'class="boton"',
  "Entrar",
]);

// 1b. Los archivos que la pantalla de entrada necesita, SIN sesión ---------
for (const archivo of ["/style.css", "/logo-marca.png", "/carga.js", "/fonts/geist-latin.woff2"]) {
  const respuesta = await fetch(`${BASE}${archivo}`, { redirect: "manual" });
  if (respuesta.status !== 200) {
    fallos.push(archivo);
    console.log(`  x ${archivo} -- responde ${respuesta.status}, deberia ser 200`);
  } else {
    console.log(`  ok ${archivo}`);
  }
}

// 2. Lista de clientes -----------------------------------------------------
r = await traer("/clientes");
comprobar("lista de clientes", r.html, [
  'class="page-ancha"',
  'class="cabecera-app"',
  "chip-cabecera",
  "Salir",
  "Lista de clientes",
  "boton-nuevo",
  'class="filtros"',
  "filtro-nombre",
  "filtro-numero",
  "clientes-grid",
  'class="barra"',
  "barra-pestanas",
]);

const id = r.html.match(/href="\/clientes\/([0-9a-f-]{36})"/)?.[1];
if (!id) {
  fallos.push("no se ha encontrado ningún cliente en la lista");
  console.log("  x sin clientes: no se pueden comprobar las pantallas de ficha");
} else {
  // 3. Ficha del cliente ---------------------------------------------------
  r = await traer(`/clientes/${id}`);
  comprobar("ficha del cliente", r.html, [
    'class="page sin-barra"',
    'class="volver"',
    "ficha-titulo",
    "perfil-hero",
    "programa-nombre",
    'class="estado"',
    "pill-boton",
    "acciones-perfil",
    "Editar datos",
    "Editar programa",
    "boton-copiar",
    "Copiar enlace del cliente",
    "lista historial",
    "Historial de programas",
  ]);

  // 4. Editar datos --------------------------------------------------------
  r = await traer(`/clientes/${id}/datos`);
  comprobar("editar datos", r.html, [
    "Editar datos",
    "Quién es el cliente y en qué situación está",
    "Nombre del cliente",
    "Estado del cliente",
    "Revisar cambios",
    "zona-peligrosa",
    "Zona peligrosa",
  ]);

  // 5. Editar programa -----------------------------------------------------
  r = await traer(`/clientes/${id}/programa`);
  comprobar("editar programa", r.html, [
    "Editar programa",
    "Modalidad del servicio",
    "Nombre del servicio",
    "ayuda-modalidad",
    "Revisar cambios",
    "Cambiar de modalidad cierra el servicio actual",
  ]);

  // 6. Editar sesión -------------------------------------------------------
  const ficha = await traer(`/clientes/${id}`);
  const sesion = ficha.html.match(/\/clientes\/[0-9a-f-]{36}\/sesion\/([0-9a-f-]{36})/)?.[1];
  if (sesion) {
    r = await traer(`/clientes/${id}/sesion/${sesion}`);
    comprobar("editar sesión", r.html, [
      "Editar sesión",
      "Fecha",
      "Sesión número",
      "Guardar cambios",
      "Eliminar esta sesión",
      "la facturación se traslada automáticamente",
    ]);
  } else {
    console.log("  · ese cliente no tiene sesiones: no se comprueba editar sesión");
  }

  // 7. Enlace público ------------------------------------------------------
  const token = ficha.html.match(/\/mi\/([A-Za-z0-9_-]{20,})/)?.[1];
  if (token) {
    r = await traer(`/mi/${token}`, false);
    comprobar("enlace público", r.html, [
      'class="page sin-barra"',
      "perfil-saludo",
      "Hola,",
      "perfil-hero",
      'class="estado"',
      "Historial de sesiones",
    ]);
  } else {
    fallos.push("no se ha encontrado el token del cliente");
  }
}

// 8. Nuevo cliente ---------------------------------------------------------
r = await traer("/clientes/nuevo");
comprobar("nuevo cliente", r.html, [
  'class="volver"',
  "Nuevo cliente",
  'class="formulario"',
  "Modalidad del servicio",
  "Revisar y crear",
]);

// 9. Economía --------------------------------------------------------------
r = await traer("/economia");
comprobar("economía", r.html, [
  "Economía",
  "Facturación por sesiones hechas (no por pagos recibidos)",
  "botones-clase",
  "+1 CrossFit Lidomare hoy",
  "+1 CrossFit Kids hoy",
  "Deshacer última Lidomare",
  "economia-resumen-grid",
  "Última semana cerrada",
  "Historial de meses",
  'class="metricas"',
]);

// 10. Avisos ---------------------------------------------------------------
r = await traer("/avisos");
comprobar("avisos", r.html, [
  "Avisos",
  "Cosas que la actualización diaria no pudo procesar sola",
  'class="lista"',
  "barra-pestanas",
]);

// 11. Salir: una precarga NO puede cerrar la sesión ------------------------
{
  const precarga = await fetch(`${BASE}/salir`, {
    redirect: "manual",
    headers: { cookie, rsc: "1", "next-router-prefetch": "1" },
  });
  const borra = (precarga.headers.getSetCookie?.() ?? []).some(
    (c) => c.startsWith("af_sesion=;") || c.includes("af_sesion=; "),
  );
  if (borra) {
    fallos.push("salir (precarga)");
    console.log("  x precargar «Salir» cierra la sesión: el enlace no puede ser un <Link>");
  } else {
    console.log("  ok precargar «Salir» no cierra la sesión");
  }

  const real = await fetch(`${BASE}/salir`, { redirect: "manual", headers: { cookie } });
  const cierra = (real.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("af_sesion=;"));
  if (!cierra) {
    fallos.push("salir");
    console.log("  x pulsar «Salir» no cierra la sesión");
  } else {
    console.log("  ok pulsar «Salir» cierra la sesión");
  }
}

console.log(fallos.length ? `\n${fallos.length} comprobacion(es) con diferencias` : "\nTodo correcto");
process.exit(fallos.length ? 1 : 0);
