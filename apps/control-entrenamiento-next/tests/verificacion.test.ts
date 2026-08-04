/**
 * La red de seguridad: que el historial y la economía sigan cuadrando.
 *
 * Lo que de verdad hay que comprobar de un detector es que **no dé falsas
 * alarmas** en el uso normal y que **sí detecte** un descuadre de verdad. Si
 * salta cuando no debe, se acaba ignorando.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { repositorio } from "@/repositories";
import { reiniciarStagingParaPruebas } from "@/repositories/staging";
import { listarAvisos } from "@/services/avisos";
import { deshacerClase, registrarClase } from "@/services/economia";
import { editarSesion, eliminarSesion, firmarSesion } from "@/services/sesiones";
import { verificarSemana } from "@/services/verificacion";

const BONO = "cli-a";
const MENSUAL = "cli-b";

describe("no da falsas alarmas en el uso normal", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("la situación de partida cuadra", async () => {
    expect(await verificarSemana("2026-07-27")).toEqual([]);
  });

  it("tras firmar, sigue cuadrando", async () => {
    await firmarSesion(BONO, { fecha: "2026-08-03" });
    expect(await verificarSemana("2026-08-03")).toEqual([]);
  });

  it("tras firmar una mensualidad, sigue cuadrando", async () => {
    await firmarSesion(MENSUAL, { fecha: "2026-08-03" });
    expect(await verificarSemana("2026-08-03")).toEqual([]);
  });

  it("tras borrar una sesión, sigue cuadrando", async () => {
    await firmarSesion(BONO, { fecha: "2026-08-03" });
    const sesion = (await repositorio().listarSesiones(BONO))[0]!;
    await eliminarSesion(BONO, sesion.id);
    expect(await verificarSemana("2026-08-03")).toEqual([]);
  });

  it("tras moverla de semana, cuadran las dos", async () => {
    await firmarSesion(BONO, { fecha: "2026-08-03" });
    const sesion = (await repositorio().listarSesiones(BONO))[0]!;
    await editarSesion(BONO, sesion.id, "2026-07-31", sesion.numeroSesion);

    expect(await verificarSemana("2026-08-03")).toEqual([]);
    expect(await verificarSemana("2026-07-27")).toEqual([]);
  });

  it("las clases de CrossFit no disparan falsas alarmas", async () => {
    await registrarClase("lidomare", "2026-08-03");
    await registrarClase("kids", "2026-08-03");
    expect(await verificarSemana("2026-08-03")).toEqual([]);

    await deshacerClase("lidomare");
    expect(await verificarSemana("2026-08-03")).toEqual([]);
  });

  it("una tanda larga de operaciones mezcladas sigue cuadrando", async () => {
    for (const fecha of ["2026-08-03", "2026-08-04", "2026-08-05"]) {
      await firmarSesion(MENSUAL, { fecha });
    }
    await registrarClase("lidomare", "2026-08-04");
    const sesiones = await repositorio().listarSesiones(MENSUAL);
    await eliminarSesion(MENSUAL, sesiones[0]!.id);

    expect(await verificarSemana("2026-08-03")).toEqual([]);
    expect((await listarAvisos()).filter((a) => a.tipo === "descuadre")).toHaveLength(0);
  });
});

describe("detecta un descuadre de verdad", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("dinero contado de más en la economía", async () => {
    await firmarSesion(BONO, { fecha: "2026-08-03" });
    // Se mete dinero a mano, saltándose la aplicación.
    await repositorio().sumarASemana("2026-08-03", 120, 1);

    const diferencias = await verificarSemana("2026-08-03");
    expect(diferencias.length).toBeGreaterThan(0);
    expect(diferencias.join(" ")).toMatch(/economía dice/i);
  });

  it("horas sin importe que no coinciden", async () => {
    await firmarSesion(MENSUAL, { fecha: "2026-08-03" });
    await repositorio().sumarASemana("2026-08-03", null, 5);

    expect((await verificarSemana("2026-08-03")).join(" ")).toMatch(/horas sin importe/i);
  });

  it("el descuadre deja un aviso al firmar la siguiente", async () => {
    await repositorio().sumarASemana("2026-08-03", 300, 3);
    await firmarSesion(BONO, { fecha: "2026-08-03" });

    const avisos = await listarAvisos();
    expect(avisos.some((a) => a.tipo === "descuadre")).toBe(true);
  });

  it("nunca corrige nada por su cuenta", async () => {
    await firmarSesion(BONO, { fecha: "2026-08-03" });
    await repositorio().sumarASemana("2026-08-03", 120, 1);
    const antes = await repositorio().listarSemanas();

    await verificarSemana("2026-08-03");

    // Solo detecta. Corregir dinero sin que nadie lo vea sería peor.
    expect(await repositorio().listarSemanas()).toEqual(antes);
  });
});
