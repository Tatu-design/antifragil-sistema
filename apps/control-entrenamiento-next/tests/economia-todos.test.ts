/**
 * «Todos»: la economía del negocio entero.
 *
 * NACE DE DINERO QUE NO SE VEÍA (2026-08-12). La pantalla de Economía se abría
 * en la del propio administrador, y el trabajo de los demás profesionales no
 * aparecía en ninguna parte: una sesión de 80 € de un cliente de Rafa estaba en
 * la base de datos, en la ficha del cliente y en ningún total que Fernando
 * pudiera mirar. Lo encontró él cuadrando su Excel.
 *
 * LA REGLA (Fernando, 2026-08-12):
 *
 *   «Al entrar en Economía como administrador quiero ver primero el total real
 *    del negocio. Todos = suma de toda la producción económica. CrossFit sigue
 *    siendo de Tatu y, por tanto, también entra en Todos.»
 *
 * Y la condición que lo mantiene sano en el tiempo: **un profesional nuevo
 * entra en «Todos» solo**, sin que nadie tenga que acordarse de sumarlo.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { alcanceEconomico } from "@/domain/atribucion";
import { TARIFA_LIDOMARE } from "@/domain/economia";
import { hoyNegocio } from "@/lib/fechas";
import { repositorio } from "@/repositories";
import { reiniciarStagingParaPruebas } from "@/repositories/staging";
import { firmarClase } from "@/services/clases";
import { obtenerEconomia } from "@/services/economia";
import { firmarSesion } from "@/services/sesiones";
import { SelectorProfesional } from "@/components/SelectorProfesional";

const ADMIN = "per-admin";
const RAFA = "per-rafa";
const OTRO = "per-otro";

const RAIZ_SRC = path.join(process.cwd(), "src");

const HOY = hoyNegocio();
const ANIO = Number(HOY.slice(0, 4));
const MES = Number(HOY.slice(5, 7));

const PERFILES = [
  { id: ADMIN, rol: "admin" as const },
  { id: RAFA, rol: "entrenador" as const },
  { id: OTRO, rol: "entrenador" as const },
];

const todos = () => obtenerEconomia({ profesionalId: null, esAdministrador: true, adminId: ADMIN });
const deAdmin = () => obtenerEconomia({ profesionalId: ADMIN, esAdministrador: true, adminId: ADMIN });
const deRafa = () => obtenerEconomia({ profesionalId: RAFA, adminId: ADMIN });
const deOtro = () => obtenerEconomia({ profesionalId: OTRO, adminId: ADMIN });

/** Deja el mes en curso vacío, para partir de cero de verdad. */
async function vaciarMesActual() {
  const repo = repositorio();
  const prefijo = HOY.slice(0, 7);
  for (const cliente of await repo.listarClientes()) {
    for (const sesion of await repo.listarSesiones(cliente.id)) {
      if (sesion.fecha.startsWith(prefijo)) await repo.eliminarSesion(sesion.id);
    }
    const cargo = await repo.cargoDelMes(cliente.id, ANIO, MES);
    if (cargo) await repo.guardarCargo({ ...cargo, importe: 0 });
  }
  for (const tipo of ["lidomare", "kids"] as const) {
    for (const clase of await repo.clasesDelMes(tipo, ANIO, MES)) await repo.borrarClase(clase.id);
  }
}

/** Los datos de pruebas traen algún cliente pausado; a este hay que firmarle. */
async function activar(clienteId: string) {
  const repo = repositorio();
  const cliente = (await repo.obtenerCliente(clienteId))!;
  await repo.actualizarCliente({ ...cliente, estado: "activo" });
}

// ---------------------------------------------------------------------------
// Qué se está mirando
// ---------------------------------------------------------------------------

describe("qué economía se está mirando", () => {
  it("sin nadie elegido, el negocio entero", () => {
    // Lo que se ve AL ENTRAR. Es la corrección del 2026-08-12.
    expect(alcanceEconomico(undefined, PERFILES).profesionalId).toBeNull();
    expect(alcanceEconomico(null, PERFILES).profesionalId).toBeNull();
    expect(alcanceEconomico("", PERFILES).profesionalId).toBeNull();
  });

  it("en «todos» entran también CrossFit y los ajustes", () => {
    // No son de ningún cliente, pero son producción del negocio.
    expect(alcanceEconomico(undefined, PERFILES).esAdministrador).toBe(true);
  });

  it("con uno elegido, solo el suyo", () => {
    expect(alcanceEconomico(RAFA, PERFILES).profesionalId).toBe(RAFA);
    expect(alcanceEconomico(RAFA, PERFILES).esAdministrador).toBe(false);
    expect(alcanceEconomico(ADMIN, PERFILES).esAdministrador).toBe(true);
  });

  it("un identificador inventado NO devuelve la economía de nadie: cae en «todos»", () => {
    // Escribir `?profesional=<lo-que-sea>` a mano no puede colar a nadie.
    expect(alcanceEconomico("per-inventado", PERFILES).profesionalId).toBeNull();
    expect(alcanceEconomico("'; drop table sesiones; --", PERFILES).profesionalId).toBeNull();
  });

  it("siempre dice quién es el administrador, se mire lo que se mire", () => {
    // Suyo es todo el histórico anterior a que existieran los profesionales:
    // sin este dato, ese pasado se quedaría sin dueño y desaparecería.
    for (const pedido of [undefined, ADMIN, RAFA, "inventado"]) {
      expect(alcanceEconomico(pedido, PERFILES).adminId, String(pedido)).toBe(ADMIN);
    }
  });
});

// ---------------------------------------------------------------------------
// Todos = la suma
// ---------------------------------------------------------------------------

describe("«Todos» es la suma de todos", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("la producción de cada profesional entra entera en el total", async () => {
    await vaciarMesActual();
    // Uno de cada: «cli-a» es del administrador, «cli-d» de Rafa y «cli-e» del
    // otro entrenador (que viene pausado en los datos de pruebas).
    await activar("cli-e");
    await firmarSesion("cli-a", { fecha: HOY });
    await firmarSesion("cli-d", { fecha: HOY });
    await firmarSesion("cli-e", { fecha: HOY });

    const [t, a, r, o] = await Promise.all([todos(), deAdmin(), deRafa(), deOtro()]);

    expect(a.mesActual.facturacionTotal + r.mesActual.facturacionTotal + o.mesActual.facturacionTotal)
      .toBe(t.mesActual.facturacionTotal);
    expect(a.mesActual.horasTotales + r.mesActual.horasTotales + o.mesActual.horasTotales)
      .toBe(t.mesActual.horasTotales);
    // Y no es que sumen cero: hay producción de los tres.
    expect(r.mesActual.horasTotales).toBe(1);
    expect(o.mesActual.horasTotales).toBe(1);
    expect(t.mesActual.horasTotales).toBe(3);
  });

  it("CrossFit es de Tatu y, por tanto, también está en el total", async () => {
    await vaciarMesActual();
    await firmarClase("lidomare", HOY);

    const [t, a, r] = await Promise.all([todos(), deAdmin(), deRafa()]);

    expect(a.mesActual.facturacionTotal).toBe(TARIFA_LIDOMARE);
    expect(t.mesActual.facturacionTotal).toBe(TARIFA_LIDOMARE);
    // Y no se le atribuye a un entrenador ni se cuenta dos veces.
    expect(r.mesActual.facturacionTotal).toBe(0);
    expect(t.mesActual.horasTotales).toBe(a.mesActual.horasTotales);
  });

  it("una mensualidad entra una sola vez en el total", async () => {
    // Las cuotas son exclusivas del administrador: si se contaran también en
    // la vista de un entrenador, la suma saldría de más.
    await vaciarMesActual();
    const repo = repositorio();
    const cargo = await repo.cargoDelMes("cli-b", ANIO, MES);
    if (cargo) await repo.guardarCargo({ ...cargo, importe: 720 });

    const [t, a, r] = await Promise.all([todos(), deAdmin(), deRafa()]);

    expect(t.mesActual.facturacionTotal).toBe(720);
    expect(a.mesActual.facturacionTotal).toBe(720);
    expect(r.mesActual.facturacionTotal).toBe(0);
  });

  it("el total no se queda corto por mirar solo el mes en curso", async () => {
    // Los meses anteriores también son «todos»: son los que se cuadran contra
    // el Excel a final de mes.
    const t = await todos();
    const a = await deAdmin();
    expect(t.anteriores.length).toBeGreaterThanOrEqual(a.anteriores.length);
  });

  it("las tres métricas de siempre, ni una más", async () => {
    // Fernando pidió expresamente que no aparecieran comparativas, rankings ni
    // gráficos: las mismas cifras, con más filas dentro.
    const t = await todos();
    for (const mes of [t.mesActual, ...t.anteriores]) {
      expect(typeof mes.facturacionTotal).toBe("number");
      expect(typeof mes.horasTotales).toBe("number");
      expect(typeof mes.precioMedioHora).toBe("number");
    }
    expect(t.mesActual.anio).toBe(ANIO);
    expect(t.mesActual.mes).toBe(MES);
  });
});

// ---------------------------------------------------------------------------
// Los profesionales que aún no existen
// ---------------------------------------------------------------------------

describe("un profesional nuevo entra solo en el total", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("su producción aparece en «Todos» sin tocar una línea de código", async () => {
    // ESTA ES LA PRUEBA QUE IMPORTA A FUTURO. El día que un entrenador más
    // empiece a producir, su trabajo tiene que entrar en el total ese mismo
    // día, sin que nadie se acuerde de sumarlo en ningún sitio.
    //
    // «per-otro» hace ese papel: existe como perfil pero no ha facturado nada
    // todavía, igual que un profesional recién dado de alta.
    await vaciarMesActual();
    const repo = repositorio();
    await activar("cli-e");

    const antes = (await todos()).mesActual;
    expect((await deOtro()).mesActual.facturacionTotal, "aún no ha producido nada").toBe(0);

    await firmarSesion("cli-e", { fecha: HOY });

    const despues = (await todos()).mesActual;
    const suya = (await deOtro()).mesActual;

    expect(suya.facturacionTotal, "ahora sí produce").toBeGreaterThan(0);
    expect(despues.facturacionTotal).toBe(antes.facturacionTotal + suya.facturacionTotal);
    expect(despues.horasTotales).toBe(antes.horasTotales + 1);

    // Y la suma sigue cuadrando con TODOS los profesionales que existan, sean
    // los que sean: se recorre la lista real, no una escrita a mano.
    const profesionales = await repo.listarProfesionales();
    expect(profesionales.length).toBeGreaterThanOrEqual(3);

    let suma = 0;
    let horas = 0;
    for (const p of profesionales) {
      const economia = await obtenerEconomia({
        profesionalId: p.id,
        esAdministrador: p.rol === "admin",
        adminId: ADMIN,
      });
      suma += economia.mesActual.facturacionTotal;
      horas += economia.mesActual.horasTotales;
    }
    expect(suma).toBe(despues.facturacionTotal);
    expect(horas).toBe(despues.horasTotales);
  });

  it("el total no depende de ninguna lista de profesionales escrita a mano", () => {
    // Si el código nombrara a los profesionales uno a uno, el cuarto se
    // quedaría fuera del total sin que nadie lo notara — que es exactamente el
    // fallo que se está corrigiendo.
    // Se mira el código, no los comentarios: ahí sí se nombra a la gente para
    // explicar de dónde salen las reglas.
    const sinComentarios = (fuente: string) =>
      fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

    const fuentes = [
      ["domain/atribucion.ts", readFileSync(path.join(RAIZ_SRC, "domain", "atribucion.ts"), "utf8")],
      ["economia/page.tsx", readFileSync(path.join(RAIZ_SRC, "app", "economia", "page.tsx"), "utf8")],
      ["SelectorProfesional.tsx", readFileSync(path.join(RAIZ_SRC, "components", "SelectorProfesional.tsx"), "utf8")],
    ] as const;

    for (const [donde, fuente] of fuentes) {
      const codigo = sinComentarios(fuente);
      expect(codigo, donde).not.toMatch(/["'`]per-[a-z]/i);
      expect(codigo.toLowerCase(), donde).not.toContain("rafa");
      expect(codigo.toLowerCase(), donde).not.toContain("tatu");
    }
  });

  it("y el selector se lo encuentra sin que nadie lo escriba", () => {
    // El selector se dibuja desde la lista real de profesionales: uno nuevo
    // sale solo, y «Todos» sigue el primero.
    const html = renderToStaticMarkup(
      createElement(SelectorProfesional, {
        profesionales: [
          { id: ADMIN, nombre: "Tatu", rol: "admin" as const, fotoUrl: null },
          { id: RAFA, nombre: "Rafa Galindo", rol: "entrenador" as const, fotoUrl: null },
          { id: "per-nueva", nombre: "Profesional nueva", rol: "entrenador" as const, fotoUrl: null },
        ],
        elegido: null,
      }),
    );

    expect(html).toContain("Profesional nueva");
    expect(html.indexOf("Todos")).toBeLessThan(html.indexOf("Tatu"));
  });
});

// ---------------------------------------------------------------------------
// El selector
// ---------------------------------------------------------------------------

describe("el selector de la pantalla", () => {
  const pintar = (elegido: string | null) =>
    renderToStaticMarkup(
      createElement(SelectorProfesional, {
        profesionales: [
          { id: ADMIN, nombre: "Tatu", rol: "admin" as const, fotoUrl: null },
          { id: RAFA, nombre: "Rafa Galindo", rol: "entrenador" as const, fotoUrl: null },
        ],
        elegido,
      }),
    );

  it("«Todos» va marcado al entrar", () => {
    const html = pintar(null);
    expect(html).toMatch(/panel-opcion marcada[^>]*>Todos/);
    expect(html).toContain('aria-current="page"');
  });

  it("«Todos» vuelve a la pantalla sin filtro", () => {
    expect(pintar(null)).toContain('href="/economia"');
  });

  it("al elegir a alguien, «Todos» deja de estar marcado", () => {
    const html = pintar(RAFA);
    expect(html).not.toMatch(/panel-opcion marcada[^>]*>Todos/);
    expect(html).toMatch(/panel-opcion marcada[^>]*>Rafa Galindo/);
  });

  it("hay una opción por profesional, más «Todos»", () => {
    expect(pintar(null).match(/panel-opcion/g)?.length).toBe(3);
  });
});
