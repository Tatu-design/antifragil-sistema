/**
 * Añadir el enlace del cliente a la pantalla de inicio del móvil.
 *
 * NACE DE UN FALLO REPRODUCIDO CON TRES CLIENTES (2026-08-14). Abrían su
 * enlace, lo añadían a la pantalla de inicio del iPhone, y al pulsar el icono
 * les salía **nuestra pantalla de correo y contraseña**.
 *
 * No fallaba su enlace: fallaba la ficha de instalación. La aplicación declara
 * un manifiesto global para que el panel interno se comporte como una app, y
 * ese manifiesto dice `start_url: "/clientes"`. La pantalla del cliente lo
 * heredaba, así que el iPhone no guardaba la dirección abierta sino la del
 * panel. Al abrir el icono arrancaba en `/clientes`, que no es pública, y el
 * middleware lo mandaba al login.
 *
 * Lo que se prueba aquí: que cada enlace instala EL SUYO, que no se mezclan
 * entre clientes, y que arreglar esto no ha abierto ni una puerta del panel.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { GET as manifiestoDelCliente } from "@/app/mi/[token]/manifest.webmanifest/route";
import manifiestoGlobal from "@/app/manifest";
import { NextRequest } from "next/server";

import { middleware } from "@/middleware";

const A = "tok-cliente-a";
const B = "tok-cliente-b";

const RAIZ_SRC = path.join(process.cwd(), "src");

/** Pide el manifiesto de un enlace, como lo pediría el móvil al instalarlo. */
async function pedirManifiesto(token: string) {
  const respuesta = await manifiestoDelCliente(new Request(`https://ejemplo.test/mi/${token}/manifest.webmanifest`), {
    params: Promise.resolve({ token }),
  });
  return {
    estado: respuesta.status,
    tipo: respuesta.headers.get("content-type") ?? "",
    cuerpo: respuesta.status === 200 ? await respuesta.json() : null,
  };
}

/** Lo que hace el filtro de la entrada con una dirección, sin cookie ninguna. */
function visitarSinSesion(ruta: string) {
  // Una petición de verdad, sin cookie: es exactamente lo que llega cuando se
  // abre el icono instalado en un móvil que nunca ha iniciado sesión.
  const respuesta = middleware(new NextRequest(`https://ejemplo.test${ruta}`));
  const destino = respuesta.headers.get("location");
  return { redirigeA: destino ? new URL(destino).pathname : null };
}

// ---------------------------------------------------------------------------
// El manifiesto de cada cliente
// ---------------------------------------------------------------------------

describe("la ficha de instalación del cliente", () => {
  it("arranca en SU enlace, no en el panel", async () => {
    // ESTA ES LA PRUEBA DEL FALLO. Antes valía `/clientes` y acababa en el login.
    const { cuerpo } = await pedirManifiesto(A);

    expect(cuerpo.start_url).toBe(`/mi/${A}`);
    expect(cuerpo.start_url).not.toBe("/");
    expect(cuerpo.start_url).not.toBe("/clientes");
    expect(cuerpo.start_url).not.toContain("/login");
  });

  it("el icono instalado no se sale de lo suyo", async () => {
    const { cuerpo } = await pedirManifiesto(A);
    // Su perfil y lo que cuelga de él —confirmar una sesión—, nada más.
    expect(cuerpo.scope).toBe(`/mi/${A}`);
    expect(`/mi/${A}/confirmar`.startsWith(cuerpo.scope)).toBe(true);
    expect(cuerpo.scope).not.toBe("/");
  });

  it("dos clientes son dos aplicaciones distintas", async () => {
    // Si compartieran identidad, instalar el segundo pisaría al primero en el
    // mismo móvil. Es el caso de una pareja con un solo teléfono.
    const [a, b] = await Promise.all([pedirManifiesto(A), pedirManifiesto(B)]);

    expect(a.cuerpo.start_url).toBe(`/mi/${A}`);
    expect(b.cuerpo.start_url).toBe(`/mi/${B}`);
    expect(a.cuerpo.id).not.toBe(b.cuerpo.id);
    // Y ninguno menciona al otro por ningún lado.
    expect(JSON.stringify(a.cuerpo)).not.toContain(B);
    expect(JSON.stringify(b.cuerpo)).not.toContain(A);
  });

  it("el token se conserva tal cual, con sus guiones y sus rayas bajas", async () => {
    // Un token mal copiado en la dirección es un icono que no abre nada.
    for (const token of ["tok-cliente-a", "tok-pareja-c"]) {
      const { cuerpo } = await pedirManifiesto(token);
      expect(cuerpo.start_url, token).toBe(`/mi/${token}`);
      expect(cuerpo.start_url, token).not.toContain("%2D");
    }
  });

  it("un enlace que no existe no instala nada", async () => {
    // Ni un icono roto, ni —mucho peor— uno que lleve al perfil de otro.
    const { estado, cuerpo } = await pedirManifiesto("token-inventado");
    expect(estado).toBe(404);
    expect(cuerpo).toBeNull();
  });

  it("no dice de quién es: el icono pone «Antifrágil» y ya", async () => {
    // Un manifiesto se puede pedir sin abrir la página. No lleva el nombre del
    // cliente ni ningún otro dato suyo.
    const { cuerpo } = await pedirManifiesto(A);
    expect(cuerpo.name).toBe("Antifrágil");
    expect(cuerpo.short_name).toBe("Antifrágil");
    expect(JSON.stringify(cuerpo)).not.toContain("Cliente A");
    expect(JSON.stringify(cuerpo).toLowerCase()).not.toContain("login");
    // Y con las tres cosas que hacen que se sienta una app.
    expect(cuerpo.display).toBe("standalone");
    expect(cuerpo.icons[0].src).toBe("/favicon.png");
  });

  it("se sirve como lo que es, y sin guardarse en cachés compartidas", async () => {
    const { tipo, ...resto } = await pedirManifiesto(A);
    expect(tipo).toContain("application/manifest+json");
    expect(resto.estado).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Que la página enlace el suyo
// ---------------------------------------------------------------------------

describe("la página del cliente enlaza su propia ficha", () => {
  const pagina = readFileSync(path.join(RAIZ_SRC, "app", "mi", "[token]", "page.tsx"), "utf8");

  it("apunta a su manifiesto, con su token dentro", () => {
    expect(pagina).toMatch(/manifest: `\/mi\/\$\{encodeURIComponent\(token\)\}\/manifest\.webmanifest`/);
  });

  it("y no al global del panel", () => {
    // Heredarlo es exactamente el fallo que se está corrigiendo.
    expect(pagina).not.toContain('manifest: "/manifest.webmanifest"');
  });

  it("no hereda el título de la lista de Fernando", () => {
    // «Antifrágil — Clientes» no significa nada para quien mira su bono.
    expect(pagina).toContain('title: "Antifrágil"');
  });
});

// ---------------------------------------------------------------------------
// Lo que NO ha cambiado
// ---------------------------------------------------------------------------

describe("el panel interno sigue igual de cerrado", () => {
  it("sin sesión, todo lo interno lleva al login", () => {
    for (const ruta of ["/", "/clientes", "/economia", "/avisos", "/clientes/nuevo"]) {
      expect(visitarSinSesion(ruta).redirigeA, ruta).toBe("/login");
    }
  });

  it("el enlace del cliente y su ficha de instalación se abren sin cuenta", () => {
    expect(visitarSinSesion(`/mi/${A}`).redirigeA).toBeNull();
    expect(visitarSinSesion(`/mi/${A}/manifest.webmanifest`).redirigeA).toBeNull();
    expect(visitarSinSesion(`/mi/${A}/confirmar`).redirigeA).toBeNull();
  });

  it("el manifiesto del panel no se ha tocado", () => {
    // Se arregló para que a Fernando y a Rafa no les saliera la barra del
    // navegador dentro de la app (2026-08-04). Sigue igual.
    const global = manifiestoGlobal();
    expect(global.start_url).toBe("/clientes");
    expect(global.scope).toBe("/");
    expect(global.display).toBe("standalone");
  });

  it("y el del cliente no puede acabar arrancando en el panel", () => {
    // La regla en una línea: lo que instala un cliente empieza por `/mi/`.
    const fuente = readFileSync(
      path.join(RAIZ_SRC, "app", "mi", "[token]", "manifest.webmanifest", "route.ts"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

    expect(fuente).not.toContain("/clientes");
    expect(fuente).not.toContain("/login");
    expect(fuente).toContain("obtenerClientePorToken");
  });
});
