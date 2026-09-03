/**
 * El calendario enseña TODA la actividad firmada, no solo las sesiones.
 *
 * NACE DE UN FALLO REAL (2026-09-03). Fernando firmó una clase de CrossFit
 * Kids. La firma quedó guardada y la clase contaba en Economía, pero **el
 * calendario no la enseñaba**: solo miraba la tabla `sesiones`, y las clases de
 * CrossFit viven en `clases_grupo`.
 *
 * La corrección NO copia las clases dentro de `sesiones`: cada cosa sigue en su
 * tabla y el calendario las lee juntas. Lo que se prueba aquí es que aparecen,
 * que aparecen UNA vez, que no se inventan clientes ni cuotas por el camino, y
 * que siguen siendo del administrador.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { Calendario } from "@/components/Calendario";
import { construirMes } from "@/domain/calendario";
import { hoyNegocio } from "@/lib/fechas";
import { repositorio } from "@/repositories";
import { reiniciarStagingParaPruebas } from "@/repositories/staging";
import { obtenerCalendario } from "@/services/calendario";
import { deshacerClase, registrarClase } from "@/services/economia";
import { firmarSesion } from "@/services/sesiones";

const ADMIN = "per-admin";
const RAFA = "per-rafa";
const HOY = hoyNegocio();
const ANIO = Number(HOY.slice(0, 4));
const MES = Number(HOY.slice(5, 7));

const delMes = (profesionalId: string | null = null) =>
  obtenerCalendario({ anio: ANIO, mes: MES, profesionalId, adminId: ADMIN });

/** Deja el mes en curso sin actividad, para contar desde cero. */
async function vaciarMes() {
  const repo = repositorio();
  const prefijo = HOY.slice(0, 7);
  for (const cliente of await repo.listarClientes()) {
    for (const sesion of await repo.listarSesiones(cliente.id)) {
      if (sesion.fecha.startsWith(prefijo)) await repo.eliminarSesion(sesion.id);
    }
  }
  for (const tipo of ["lidomare", "kids"] as const) {
    for (const clase of await repo.clasesDelMes(tipo, ANIO, MES)) await repo.borrarClase(clase.id);
  }
}

// ---------------------------------------------------------------------------
// El fallo, reproducido
// ---------------------------------------------------------------------------

describe("una clase de CrossFit firmada sale en el calendario", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("CrossFit Kids aparece, y UNA sola vez", async () => {
    // EL FALLO. Antes de esto, firmar Kids no cambiaba nada en el calendario.
    await vaciarMes();
    await registrarClase("kids", HOY);

    const { mes, sesiones } = await delMes();

    const kids = sesiones.filter((s) => s.clase === "crossfit_kids");
    expect(kids, "una sola vez, no cero ni dos").toHaveLength(1);
    expect(kids[0].fecha).toBe(HOY);
    expect(kids[0].titulo).toBe("CrossFit Kids");
    expect(mes.semanas.flat().find((d) => d.fecha === HOY)!.sesiones).toBe(1);
  });

  it("CrossFit Lidomare también", async () => {
    await vaciarMes();
    await registrarClase("lidomare", HOY);

    const { sesiones } = await delMes();
    const lidomare = sesiones.filter((s) => s.clase === "crossfit_lidomare");

    expect(lidomare).toHaveLength(1);
    expect(lidomare[0].titulo).toBe("CrossFit Lidomare");
  });

  it("las dos clases y una sesión de cliente conviven en el mismo día", async () => {
    await vaciarMes();
    await registrarClase("kids", HOY);
    await registrarClase("lidomare", HOY);
    await firmarSesion("cli-a", { fecha: HOY });

    const { mes, sesiones } = await delMes();

    expect(sesiones).toHaveLength(3);
    expect(new Set(sesiones.map((s) => s.clase))).toEqual(
      new Set(["crossfit_kids", "crossfit_lidomare", "sesion_cliente"]),
    );
    expect(mes.semanas.flat().find((d) => d.fecha === HOY)!.sesiones, "el día cuenta las tres").toBe(3);
    expect(mes.total, "y el mes también").toBe(3);
  });

  it("dos clases del mismo tipo el mismo día salen las dos", async () => {
    await vaciarMes();
    await registrarClase("kids", HOY);
    await registrarClase("kids", HOY);

    const { mes, sesiones } = await delMes();
    expect(sesiones.filter((s) => s.clase === "crossfit_kids")).toHaveLength(2);
    expect(mes.semanas.flat().find((d) => d.fecha === HOY)!.sesiones).toBe(2);
  });

  it("al deshacer la clase, desaparece del calendario", async () => {
    await vaciarMes();
    await registrarClase("kids", HOY);
    expect((await delMes()).sesiones).toHaveLength(1);

    await deshacerClase("kids");

    const { mes, sesiones } = await delMes();
    expect(sesiones).toHaveLength(0);
    expect(mes.semanas.flat().find((d) => d.fecha === HOY)!.sesiones).toBe(0);
  });

  it("una clase de otro mes no se cuela en este", async () => {
    await vaciarMes();
    const otroMes = MES === 1 ? `${ANIO - 1}-12-15` : `${ANIO}-${String(MES - 1).padStart(2, "0")}-15`;
    await registrarClase("kids", otroMes);

    expect((await delMes()).sesiones).toHaveLength(0);
  });

  it("pedirlo dos veces devuelve lo mismo: no se duplica al recargar", async () => {
    await vaciarMes();
    await registrarClase("kids", HOY);

    const una = await delMes();
    const dos = await delMes();

    expect(dos.sesiones).toHaveLength(una.sesiones.length);
    expect(dos.mes.total).toBe(una.mes.total);
  });
});

// ---------------------------------------------------------------------------
// No se inventa nada por el camino
// ---------------------------------------------------------------------------

describe("firmar CrossFit no crea nada que no sea una clase", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("ni clientes, ni sesiones, ni ciclos, ni cuotas", async () => {
    // La tentación fácil habría sido meter las clases en `sesiones`. No se ha
    // hecho: cada cosa sigue en su tabla.
    const repo = repositorio();
    await vaciarMes();

    const clientesAntes = (await repo.listarClientes()).length;
    const sesionesAntes = (
      await Promise.all((await repo.listarClientes()).map((c) => repo.listarSesiones(c.id)))
    ).flat().length;
    const ciclosAntes = (
      await Promise.all((await repo.listarClientes()).map((c) => repo.listarCiclos(c.id)))
    ).flat().length;
    const cargosAntes = (
      await Promise.all((await repo.listarClientes()).map((c) => repo.listarCargos(c.id)))
    ).flat().length;

    await registrarClase("kids", HOY);
    await registrarClase("lidomare", HOY);

    expect((await repo.listarClientes()).length, "ningún cliente nuevo").toBe(clientesAntes);
    expect(
      (await Promise.all((await repo.listarClientes()).map((c) => repo.listarSesiones(c.id)))).flat().length,
      "ninguna sesión individual falsa",
    ).toBe(sesionesAntes);
    expect(
      (await Promise.all((await repo.listarClientes()).map((c) => repo.listarCiclos(c.id)))).flat().length,
      "ningún ciclo",
    ).toBe(ciclosAntes);
    expect(
      (await Promise.all((await repo.listarClientes()).map((c) => repo.listarCargos(c.id)))).flat().length,
      "ninguna cuota",
    ).toBe(cargosAntes);
  });

  it("una clase no dice ser de ningún cliente", async () => {
    await vaciarMes();
    await registrarClase("kids", HOY);

    const clase = (await delMes()).sesiones[0];
    expect(clase.clienteId, "no puede enlazar a una ficha que no existe").toBeNull();
    expect(clase.detalle, "no tiene programa").toBe("");
    expect(clase.hora, "y no se le inventa una hora").toBeNull();
  });
});

// ---------------------------------------------------------------------------
// De quién es CrossFit
// ---------------------------------------------------------------------------

describe("CrossFit es del administrador", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("sale en «Todos»", async () => {
    await vaciarMes();
    await registrarClase("kids", HOY);
    expect((await delMes(null)).sesiones.filter((s) => s.clase === "crossfit_kids")).toHaveLength(1);
  });

  it("sale en el calendario del administrador", async () => {
    await vaciarMes();
    await registrarClase("kids", HOY);
    expect((await delMes(ADMIN)).sesiones.filter((s) => s.clase === "crossfit_kids")).toHaveLength(1);
  });

  it("NO sale en el de un entrenador", async () => {
    // No es suya: no le corresponde ni verla.
    await vaciarMes();
    await registrarClase("kids", HOY);
    await registrarClase("lidomare", HOY);

    const suyo = await delMes(RAFA);

    expect(suyo.sesiones.filter((s) => s.clase !== "sesion_cliente")).toHaveLength(0);
    expect(JSON.stringify(suyo.sesiones)).not.toContain("CrossFit");
  });

  it("y tampoco al filtrar por un entrenador desde la vista del administrador", async () => {
    await vaciarMes();
    await registrarClase("kids", HOY);
    await firmarSesion("cli-d", { fecha: HOY }); // cliente de Rafa

    const deRafa = await delMes(RAFA);

    expect(deRafa.sesiones).toHaveLength(1);
    expect(deRafa.sesiones[0].clase).toBe("sesion_cliente");
    expect(deRafa.mes.total, "su día cuenta solo lo suyo").toBe(1);
  });

  it("las clases cuentan para el administrador y para el total, sin duplicarse", async () => {
    await vaciarMes();
    await registrarClase("kids", HOY);
    await firmarSesion("cli-a", { fecha: HOY }); // cliente del administrador
    await firmarSesion("cli-d", { fecha: HOY }); // cliente de Rafa

    const [todos, admin, rafa] = await Promise.all([delMes(null), delMes(ADMIN), delMes(RAFA)]);

    expect(todos.mes.total).toBe(3);
    expect(admin.mes.total, "su sesión y la clase").toBe(2);
    expect(rafa.mes.total, "solo la suya").toBe(1);
    expect(admin.mes.total + rafa.mes.total, "y las partes suman el total").toBe(todos.mes.total);
  });
});

// ---------------------------------------------------------------------------
// Cómo se ve
// ---------------------------------------------------------------------------

describe("cómo se pinta una clase de grupo", () => {
  const mes = construirMes(2026, 9, "2026-09-03", new Map([["2026-09-03", 3]]));
  const actividad = [
    {
      id: "s1",
      clase: "sesion_cliente" as const,
      clienteId: "cli-a",
      titulo: "Cliente A",
      fecha: "2026-09-03",
      hora: "09:00",
      detalle: "Bono 8 sesiones",
      profesionalId: "per-admin",
    },
    {
      id: "g1",
      clase: "crossfit_kids" as const,
      clienteId: null,
      titulo: "CrossFit Kids",
      fecha: "2026-09-03",
      hora: null,
      detalle: "",
      profesionalId: "per-admin",
    },
    {
      id: "g2",
      clase: "crossfit_lidomare" as const,
      clienteId: null,
      titulo: "CrossFit Lidomare",
      fecha: "2026-09-03",
      hora: null,
      detalle: "",
      profesionalId: "per-admin",
    },
  ];

  const pintar = () =>
    renderToStaticMarkup(
      createElement(Calendario, {
        mes,
        sesiones: actividad,
        hoy: "2026-09-03",
        nombresDeProfesionales: { "per-admin": "Tatu" },
        agruparPorProfesional: false,
      }),
    );

  it("se lee «CrossFit Kids» y «CrossFit Lidomare»", () => {
    const html = pintar();
    expect(html).toContain("CrossFit Kids");
    expect(html).toContain("CrossFit Lidomare");
  });

  it("las clases NO llevan enlace a ninguna ficha", () => {
    // Enlazar a un cliente que no existe daría una pantalla de «no encontrado».
    const html = pintar();
    expect(html).toContain('href="/clientes/cli-a"');
    expect(html).not.toMatch(/href="\/clientes\/(null|undefined|g1|g2)"/);
  });

  it("la sesión de un cliente sí lo lleva, como siempre", () => {
    expect(pintar()).toContain('href="/clientes/cli-a"');
  });

  it("una clase sin hora enseña una raya, no una hora inventada", () => {
    expect(pintar()).toContain("—");
  });
});

// ---------------------------------------------------------------------------
// Lo que no se puede romper
// ---------------------------------------------------------------------------

describe("las sesiones de clientes siguen igual", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("se ven, con su cliente y su programa", async () => {
    await vaciarMes();
    await firmarSesion("cli-a", { fecha: HOY });

    const sesion = (await delMes()).sesiones[0];
    expect(sesion.clase).toBe("sesion_cliente");
    expect(sesion.titulo).toBe("Cliente A");
    expect(sesion.detalle).not.toBe("");
    expect(sesion.clienteId).toBe("cli-a");
  });

  it("borrar una sesión la quita del calendario", async () => {
    const repo = repositorio();
    await vaciarMes();
    await firmarSesion("cli-a", { fecha: HOY });
    const sesion = (await repo.listarSesiones("cli-a")).find((s) => s.fecha === HOY)!;

    await repo.eliminarSesion(sesion.id);

    expect((await delMes()).sesiones).toHaveLength(0);
  });

  it("el calendario se refresca al firmar y al borrar", () => {
    // Sin esto la clase se firma y el día sigue enseñando el número de antes.
    const acciones = readFileSync(
      path.join(process.cwd(), "src", "app", "actions.ts"),
      "utf8",
    );
    for (const accion of [
      "accionFirmar",
      "accionFirmarClase",
      "accionBorrarClase",
      "accionBorrarSesion",
      "accionEditarSesion",
    ]) {
      const desde = acciones.indexOf(`export async function ${accion}(`);
      expect(desde, accion).toBeGreaterThan(-1);
      const cuerpo = acciones.slice(desde, desde + 2200);
      expect(cuerpo, `«${accion}» tiene que refrescar el calendario`).toContain(
        'revalidatePath("/calendario")',
      );
    }
  });

  it("las clases NO se copian dentro de sesiones", () => {
    // La regla de fondo: `clases_grupo` sigue siendo la fuente de verdad de
    // CrossFit, y el calendario las lee, no las duplica.
    const fuente = readFileSync(
      path.join(process.cwd(), "src", "repositories", "postgres.ts"),
      "utf8",
    );
    const desde = fuente.indexOf("async registrarClase(");
    const cuerpo = fuente.slice(desde, desde + 700);
    expect(cuerpo).toContain("insert into clases_grupo");
    expect(cuerpo, "una clase no puede acabar en «sesiones»").not.toContain("insert into sesiones");
  });
});
