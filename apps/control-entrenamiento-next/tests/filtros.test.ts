/**
 * Los filtros de la lista de clientes.
 *
 * Son cinco condiciones que se cruzan, y de esas no se detecta a ojo cuál se
 * ha roto: la pantalla simplemente enseña de menos, que es el fallo más
 * difícil de ver — nadie echa de menos a quien no sabe que falta.
 *
 * Ojo con lo que estas pruebas NO comprueban: seguridad. Un entrenador nunca
 * recibe los clientes de otro, y eso se resuelve filtrando en la consulta
 * mucho antes de llegar aquí (ver `tests/permisos.test.ts`).
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  FILTROS_INICIALES,
  coincide,
  filtrosPuestos,
  normalizar,
  type Filtrable,
  type Filtros,
} from "@/domain/filtros";
import { BONO, CUENTA, MENSUALIDAD } from "@/domain/modalidades";
import { PanelFiltros } from "@/components/PanelFiltros";

const TATU = "per-tatu";
const RAFA = "per-rafa";

function cliente(datos: Partial<Filtrable> = {}): Filtrable {
  return {
    nombre: "Cliente A",
    estado: "activo",
    debe: false,
    profesionalId: TATU,
    modalidad: BONO,
    ...datos,
  };
}

const con = (datos: Partial<Filtros> = {}): Filtros => ({ ...FILTROS_INICIALES, ...datos });

// ---------------------------------------------------------------------------
// Buscar por nombre
// ---------------------------------------------------------------------------

describe("buscar por nombre", () => {
  it("encuentra por un trozo del nombre, no solo por el principio", () => {
    const c = cliente({ nombre: "Felipe y Javi" });
    for (const texto of ["felipe", "javi", "y ja", "FELIPE"]) {
      expect(coincide(c, { busqueda: texto, filtros: con() }), texto).toBe(true);
    }
  });

  it("los acentos no hacen falta", () => {
    // Nadie escribe tildes en el buscador del móvil con prisa.
    const c = cliente({ nombre: "Rocío" });
    expect(coincide(c, { busqueda: "rocio", filtros: con() })).toBe(true);
    expect(coincide(c, { busqueda: "Rocío", filtros: con() })).toBe(true);
  });

  it("y tampoco estorban si se ponen de más", () => {
    // Se normalizan LOS DOS lados: escribir una tilde donde no la hay tampoco
    // rompe la búsqueda. Con el teclado del móvil pasa constantemente.
    expect(coincide(cliente({ nombre: "Ana" }), { busqueda: "aná", filtros: con() })).toBe(true);
    expect(normalizar("Ánà")).toBe("ana");
  });

  it("sin escribir nada no se esconde a nadie", () => {
    expect(coincide(cliente(), { busqueda: "", filtros: con() })).toBe(true);
    expect(coincide(cliente(), { busqueda: "   ", filtros: con() })).toBe(true);
  });

  it("un nombre que no está no devuelve a nadie", () => {
    expect(coincide(cliente({ nombre: "Ana" }), { busqueda: "zzz", filtros: con() })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cada filtro por su cuenta
// ---------------------------------------------------------------------------

describe("cada filtro por separado", () => {
  it("por profesional", () => {
    expect(coincide(cliente({ profesionalId: RAFA }), { filtros: con({ profesional: RAFA }) })).toBe(true);
    expect(coincide(cliente({ profesionalId: TATU }), { filtros: con({ profesional: RAFA }) })).toBe(false);
  });

  it("un cliente sin profesional no aparece al filtrar por uno concreto", () => {
    expect(coincide(cliente({ profesionalId: null }), { filtros: con({ profesional: RAFA }) })).toBe(false);
  });

  it("por estado del cliente", () => {
    expect(coincide(cliente({ estado: "pausado" }), { filtros: con({ estados: ["pausado"] }) })).toBe(true);
    expect(coincide(cliente({ estado: "activo" }), { filtros: con({ estados: ["pausado"] }) })).toBe(false);
  });

  it("por tipo de programa", () => {
    expect(coincide(cliente({ modalidad: MENSUALIDAD }), { filtros: con({ modalidades: [MENSUALIDAD] }) })).toBe(true);
    expect(coincide(cliente({ modalidad: BONO }), { filtros: con({ modalidades: [MENSUALIDAD] }) })).toBe(false);
  });

  it("por deuda", () => {
    expect(coincide(cliente({ debe: true }), { soloPendientes: true, filtros: con() })).toBe(true);
    expect(coincide(cliente({ debe: false }), { soloPendientes: true, filtros: con() })).toBe(false);
  });

  it("un grupo vacío no filtra nada: significa «todos»", () => {
    const todos = con({ estados: [], modalidades: [] });
    expect(coincide(cliente({ estado: "cancelado", modalidad: CUENTA }), { filtros: todos })).toBe(true);
  });

  it("dentro de un grupo, marcar dos suma opciones", () => {
    const f = con({ estados: ["pausado", "cancelado"] });
    expect(coincide(cliente({ estado: "pausado" }), { filtros: f })).toBe(true);
    expect(coincide(cliente({ estado: "cancelado" }), { filtros: f })).toBe(true);
    expect(coincide(cliente({ estado: "activo" }), { filtros: f })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Los filtros se suman
// ---------------------------------------------------------------------------

describe("los filtros se suman entre grupos", () => {
  it("«los de Rafa que deben dinero» exige las dos cosas", () => {
    const filtros = con({ profesional: RAFA });
    const opciones = { soloPendientes: true, filtros };

    expect(coincide(cliente({ profesionalId: RAFA, debe: true }), opciones)).toBe(true);
    // De Rafa, pero al día.
    expect(coincide(cliente({ profesionalId: RAFA, debe: false }), opciones)).toBe(false);
    // Debe dinero, pero no es de Rafa.
    expect(coincide(cliente({ profesionalId: TATU, debe: true }), opciones)).toBe(false);
  });

  it("las tres a la vez: profesional, estado y tipo de programa", () => {
    const filtros = con({ profesional: RAFA, estados: ["pausado"], modalidades: [CUENTA] });
    const encaja = cliente({ profesionalId: RAFA, estado: "pausado", modalidad: CUENTA });

    expect(coincide(encaja, { filtros })).toBe(true);
    expect(coincide({ ...encaja, modalidad: BONO }, { filtros })).toBe(false);
    expect(coincide({ ...encaja, estado: "activo" }, { filtros })).toBe(false);
    expect(coincide({ ...encaja, profesionalId: TATU }, { filtros })).toBe(false);
  });

  it("y la búsqueda se suma también", () => {
    const filtros = con({ profesional: RAFA });
    const c = cliente({ nombre: "Nikki", profesionalId: RAFA });
    expect(coincide(c, { busqueda: "nik", filtros })).toBe(true);
    // El nombre acierta pero el profesional no.
    expect(coincide({ ...c, profesionalId: TATU }, { busqueda: "nik", filtros })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// El aviso del botón
// ---------------------------------------------------------------------------

describe("cuántos filtros dice que hay puestos", () => {
  it("recién abierta la pantalla, ninguno", () => {
    // Abrir en «activos» es el punto de partida, no un filtro. Si contara, el
    // botón diría siempre «1» y el aviso dejaría de significar nada.
    expect(filtrosPuestos(FILTROS_INICIALES)).toBe(0);
  });

  it("cuenta uno por grupo tocado, no uno por opción", () => {
    expect(filtrosPuestos(con({ profesional: RAFA }))).toBe(1);
    expect(filtrosPuestos(con({ modalidades: [BONO, CUENTA] }))).toBe(1);
    expect(filtrosPuestos(con({ profesional: RAFA, modalidades: [BONO] }))).toBe(2);
  });

  it("quitar «activos» también es filtrar", () => {
    expect(filtrosPuestos(con({ estados: [] }))).toBe(1);
    expect(filtrosPuestos(con({ estados: ["cancelado"] }))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// El panel, dibujado
// ---------------------------------------------------------------------------

const perfil = (id: string, nombre: string, rol: "admin" | "entrenador" = "entrenador") => ({
  id,
  nombre,
  rol,
  // La foto va por su dirección, no incrustada: pesaba 18 KB por profesional
  // dentro de la propia página (2026-08-12).
  fotoUrl: null,
});

const pintar = (props: Partial<Parameters<typeof PanelFiltros>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(PanelFiltros, {
      abierto: true,
      alCerrar: () => {},
      filtros: FILTROS_INICIALES,
      alCambiar: () => {},
      profesionales: [perfil("per-tatu", "Tatu", "admin"), perfil("per-rafa", "Rafa Galindo")],
      cuantos: 3,
      ...props,
    }),
  );

describe("el panel de filtros", () => {
  it("cerrado no dibuja nada", () => {
    expect(pintar({ abierto: false })).toBe("");
  });

  it("abierto trae los tres grupos", () => {
    const html = pintar();
    expect(html).toContain("Profesional");
    expect(html).toContain("Estado del cliente");
    expect(html).toContain("Tipo de programa");
  });

  it("ofrece a los profesionales que existen, y «Todos»", () => {
    const html = pintar();
    expect(html).toContain("Todos");
    expect(html).toContain("Tatu");
    expect(html).toContain("Rafa Galindo");
  });

  it("a un entrenador no le enseña el grupo de profesional", () => {
    // Solo tiene clientes suyos: no habría nada que separar.
    const html = pintar({ profesionales: [] });
    expect(html).not.toContain("Profesional");
    // Pero los otros dos grupos sí.
    expect(html).toContain("Estado del cliente");
    expect(html).toContain("Tipo de programa");
  });

  it("dice cuántos clientes quedan antes de cerrar", () => {
    expect(pintar({ cuantos: 3 })).toContain("Ver 3 clientes");
    expect(pintar({ cuantos: 1 })).toContain("Ver 1 cliente");
    expect(pintar({ cuantos: 0 })).toContain("Ver 0 clientes");
  });

  it("lo marcado se dice también sin color", () => {
    // `aria-pressed` para quien no distingue el verde del blanco.
    const html = pintar({ filtros: con({ modalidades: [BONO] }) });
    expect(html).toContain('aria-pressed="true"');
  });

  it("es una ventana de verdad para quien usa lector de pantalla", () => {
    const html = pintar();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
  });
});
