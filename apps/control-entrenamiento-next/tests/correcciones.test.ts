/**
 * Corregir una sesión, dar de baja a un cliente y los avisos.
 *
 * Son las tres operaciones que quedaban para igualar a la aplicación Flask, y
 * las tres tocan dinero ya contado. Por eso se comprueba sobre todo que **no
 * dejen cifras huérfanas**.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { repositorio } from "@/repositories";
import { reiniciarStagingParaPruebas } from "@/repositories/staging";
import { listarAvisos, resolverAviso, resolverPorTipo } from "@/services/avisos";
import { obtenerPerfil } from "@/services/clientes";
import { editarSesion, eliminarClienteConHistorial, firmarSesion } from "@/services/sesiones";

const BONO = "cli-a"; // bono 8 × 45 €, 6 hechas
const CUENTA = "cli-f"; // 35 €/sesión. Es del ADMIN: un entrenador solo lleva bonos.

describe("corregir una sesión", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("cambiar el número no mueve dinero", async () => {
    await firmarSesion(BONO, { fecha: "2026-08-03" });
    const antes = await repositorio().listarSemanas();
    const sesion = (await repositorio().listarSesiones(BONO))[0]!;

    await editarSesion(BONO, sesion.id, sesion.fecha, 5);

    expect(await repositorio().listarSemanas()).toEqual(antes);
    const despues = (await repositorio().listarSesiones(BONO)).find((s) => s.id === sesion.id)!;
    expect(despues.numeroSesion).toBe(5);
  });

  it("moverla a otra semana traslada su importe y su hora", async () => {
    await firmarSesion(BONO, { fecha: "2026-08-03" });
    const sesion = (await repositorio().listarSesiones(BONO))[0]!;

    await editarSesion(BONO, sesion.id, "2026-07-31", sesion.numeroSesion);

    const semanas = await repositorio().listarSemanas();
    expect(semanas.find((s) => s.inicio === "2026-08-03")?.facturacion ?? 0).toBe(0);
    // La semana del 27 de julio ya traía 3 sesiones de 45 €; ahora suma una más.
    expect(semanas.find((s) => s.inicio === "2026-07-27")!.horas).toBe(4);
  });

  it("usa la tarifa de la sesión, no la actual del servicio", async () => {
    await firmarSesion(CUENTA, { fecha: "2026-08-03" });
    const sesion = (await repositorio().listarSesiones(CUENTA))[0]!;
    const ciclo = await repositorio().cicloActual(CUENTA);
    await repositorio().guardarCiclo({ ...ciclo!, tarifa: 90 });

    await editarSesion(CUENTA, sesion.id, "2026-07-31", 1);

    const semanas = await repositorio().listarSemanas();
    // Se mueven los 35 € que sumó, no los 90 € de ahora.
    expect(semanas.find((s) => s.inicio === "2026-08-03")?.facturacion ?? 0).toBe(0);
  });

  it("una fecha imposible se rechaza", async () => {
    await firmarSesion(BONO, { fecha: "2026-08-03" });
    const sesion = (await repositorio().listarSesiones(BONO))[0]!;
    await expect(editarSesion(BONO, sesion.id, "no-es-fecha", 1)).rejects.toThrow(/no válida/i);
  });

  it("un número fuera del bono se rechaza", async () => {
    await firmarSesion(BONO, { fecha: "2026-08-03" });
    const sesion = (await repositorio().listarSesiones(BONO))[0]!;
    await expect(editarSesion(BONO, sesion.id, sesion.fecha, 99)).rejects.toThrow(/entre 1 y 8/i);
  });

  it("en una cuenta sin tope, cualquier número alto vale", async () => {
    await firmarSesion(CUENTA, { fecha: "2026-08-03" });
    const sesion = (await repositorio().listarSesiones(CUENTA))[0]!;
    // `sesionesTotales = 0` es SIN LÍMITE, no cero.
    await expect(editarSesion(CUENTA, sesion.id, sesion.fecha, 99)).resolves.toBeUndefined();
  });

  it("no deja tocar una sesión de un servicio ya cerrado", async () => {
    await firmarSesion(BONO, { fecha: "2026-08-03" }); // 7
    await firmarSesion(BONO, { fecha: "2026-08-04" }); // 8 → renueva
    await firmarSesion(BONO, { fecha: "2026-08-05" }); // 1 del nuevo

    const antigua = (await repositorio().listarSesiones(BONO)).find((s) => s.numeroSesion === 8)!;
    await expect(editarSesion(BONO, antigua.id, "2026-08-06", 8)).rejects.toThrow(/ya cerrado/i);
  });
});

describe("dar de baja a un cliente", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("retira también su facturación: no queda dinero sin sesión detrás", async () => {
    const antes = await repositorio().listarSemanas();
    const suyas = await repositorio().listarSesiones(BONO);
    const suImporte = suyas.reduce((s, x) => s + (x.tarifa ?? 0), 0);

    const resultado = await eliminarClienteConHistorial(BONO);

    expect(resultado.sesionesBorradas).toBe(suyas.length);
    expect(resultado.importeDescontado).toBe(suImporte);

    const despues = await repositorio().listarSemanas();
    const totalAntes = antes.reduce((s, x) => s + x.facturacion, 0);
    const totalDespues = despues.reduce((s, x) => s + x.facturacion, 0);
    expect(Math.round((totalAntes - totalDespues) * 100) / 100).toBe(suImporte);
  });

  it("desaparece de la lista y ya no tiene perfil", async () => {
    await eliminarClienteConHistorial(BONO);
    expect(await obtenerPerfil(BONO)).toBeNull();
    expect((await repositorio().listarClientes()).some((c) => c.id === BONO)).toBe(false);
  });

  it("no toca a los demás clientes", async () => {
    const otras = await repositorio().listarSesiones("cli-c");
    await eliminarClienteConHistorial(BONO);
    expect(await repositorio().listarSesiones("cli-c")).toEqual(otras);
  });

  it("un cliente que ya no existe avisa en vez de romper", async () => {
    await expect(eliminarClienteConHistorial("no-existe")).rejects.toThrow(/ya no existe/i);
  });
});

describe("avisos", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("firmar la penúltima sesión avisa de que queda una", async () => {
    await firmarSesion(BONO, { fecha: "2026-08-03" }); // deja 1
    const avisos = await listarAvisos();
    expect(avisos.some((a) => a.tipo === "ultima_sesion")).toBe(true);
  });

  it("agotar el servicio avisa de la renovación", async () => {
    await firmarSesion(BONO, { fecha: "2026-08-03" });
    await firmarSesion(BONO, { fecha: "2026-08-04" });
    const avisos = await listarAvisos();
    expect(avisos.some((a) => a.tipo === "servicio_terminado")).toBe(true);
  });

  it("el mismo aviso no se repite mientras siga sin resolver", async () => {
    const repo = repositorio();
    for (let i = 0; i < 3; i += 1) {
      await repo.registrarAviso({ fecha: "2026-08-03", tipo: "descuadre", detalle: "el mismo texto" });
    }
    expect((await listarAvisos()).filter((a) => a.tipo === "descuadre")).toHaveLength(1);
  });

  it("descartar uno lo quita de la bandeja", async () => {
    await firmarSesion(BONO, { fecha: "2026-08-03" });
    const aviso = (await listarAvisos())[0]!;
    await resolverAviso(aviso.id);
    expect((await listarAvisos()).some((a) => a.id === aviso.id)).toBe(false);
  });

  it("se pueden descartar todos los de un tipo de golpe", async () => {
    const repo = repositorio();
    for (const detalle of ["uno", "dos", "tres"]) {
      await repo.registrarAviso({ fecha: "2026-08-03", tipo: "descuadre", detalle });
    }
    expect(await resolverPorTipo("descuadre")).toBe(3);
    expect((await listarAvisos()).filter((a) => a.tipo === "descuadre")).toHaveLength(0);
  });

  it("verlos no los resuelve: son cosas distintas", async () => {
    await firmarSesion(BONO, { fecha: "2026-08-03" });
    const repo = repositorio();
    expect(await repo.contarNoLeidos()).toBeGreaterThan(0);

    await repo.marcarTodosLeidos();
    expect(await repo.contarNoLeidos()).toBe(0);
    // Siguen ahí: verlo no lo arregla.
    expect((await listarAvisos()).length).toBeGreaterThan(0);
  });
});
