/**
 * Borrar una sesión deja la cuenta cuadrada (2026-08-04).
 *
 * Equivalente en Next.js a `tests/test_numeracion_sesiones.py` de Flask, donde
 * el fallo apareció primero: Fernando borró una sesión de Paquito y el marcador
 * principal no se movió. El contador se calculaba con el NÚMERO de la última
 * sesión que quedaba, no con cuántas había — borrada la nº 1 de 7, la última
 * seguía siendo la nº 7. El mismo fallo estaba portado aquí.
 *
 * Se comprueban las dos mitades: que la numeración y el contador se cuadran, y
 * que la economía del mes se ajusta sola.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { repositorio } from "@/repositories";
import { reiniciarStagingParaPruebas } from "@/repositories/staging";
import { obtenerPerfil } from "@/services/clientes";
import { obtenerMes } from "@/services/economia";
import { comprobarCoherencia, diagnosticar, reparar } from "@/services/reparacion";
import { eliminarSesion, firmarSesion } from "@/services/sesiones";

const BONO = "cli-a"; // bono de 8 × 45 €
const CUENTA = "cli-f"; // cuenta de cliente del admin, 35 €/sesión
const MENSUAL = "cli-b"; // mensualidad de 720 € al mes

/** Deja al cliente sin ninguna sesión, para partir de cero. */
async function vaciar(clienteId: string) {
  const repo = repositorio();
  for (const sesion of await repo.listarSesiones(clienteId)) {
    await repo.eliminarSesion(sesion.id);
  }
  const cliente = await repo.obtenerCliente(clienteId);
  if (cliente) {
    cliente.sesionesCompletadas = 0;
    await repo.actualizarCliente(cliente);
  }
}

async function numeros(clienteId: string): Promise<number[]> {
  const sesiones = await repositorio().listarSesiones(clienteId);
  return sesiones.map((s) => s.numeroSesion).sort((a, b) => a - b);
}

async function contador(clienteId: string): Promise<number> {
  return (await repositorio().obtenerCliente(clienteId))!.sesionesCompletadas;
}

async function sesionNumero(clienteId: string, numero: number) {
  const sesiones = await repositorio().listarSesiones(clienteId);
  return sesiones.find((s) => s.numeroSesion === numero)!;
}

/** El caso real de Paquito: siete sesiones firmadas en julio. */
async function siete(clienteId = BONO) {
  await vaciar(clienteId);
  for (const dia of ["02", "09", "10", "15", "17", "23", "29"]) {
    await firmarSesion(clienteId, { fecha: `2026-07-${dia}` });
  }
}

/** El mes de julio, ya calculado. Nunca es nulo en estas pruebas. */
const julio = async () => (await obtenerMes(2026, 7))!;

describe("borrar una sesión: numeración y contador", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("el punto de partida es el esperado", async () => {
    await siete();
    expect(await numeros(BONO)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(await contador(BONO)).toBe(7);
  });

  it("borrar la primera baja el contador y renumera", async () => {
    await siete();
    await eliminarSesion(BONO, (await sesionNumero(BONO, 1)).id);

    expect(await contador(BONO)).toBe(6);
    expect(await numeros(BONO)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("borrar una del medio también", async () => {
    await siete();
    await eliminarSesion(BONO, (await sesionNumero(BONO, 4)).id);

    expect(await contador(BONO)).toBe(6);
    expect(await numeros(BONO)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("borrar la última también", async () => {
    await siete();
    await eliminarSesion(BONO, (await sesionNumero(BONO, 7)).id);

    expect(await contador(BONO)).toBe(6);
    expect(await numeros(BONO)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("borrar varias seguidas", async () => {
    await siete();
    for (const numero of [1, 3, 2]) {
      await eliminarSesion(BONO, (await sesionNumero(BONO, numero)).id);
    }
    expect(await contador(BONO)).toBe(4);
    expect(await numeros(BONO)).toEqual([1, 2, 3, 4]);
  });

  it("la ficha y su historial nunca se contradicen", async () => {
    // Lo que veía Fernando: «7 de 8» arriba y 6 sesiones abajo.
    await siete();
    for (const numero of [1, 2, 3]) {
      await eliminarSesion(BONO, (await sesionNumero(BONO, numero)).id);
      const perfil = await obtenerPerfil(BONO);
      const enCurso = perfil!.servicios.find((c) => c.esActual)!;
      expect(await contador(BONO)).toBe(enCurso.sesiones.length);
    }
  });

  it("al firmar después sigue la numeración", async () => {
    await siete();
    await eliminarSesion(BONO, (await sesionNumero(BONO, 1)).id);
    await firmarSesion(BONO, { fecha: "2026-07-30" });

    expect(await numeros(BONO)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(await contador(BONO)).toBe(7);
  });
});

describe("borrar una sesión: la economía se ajusta", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("quita su hora y su importe", async () => {
    await siete();
    const antes = await julio();
    await eliminarSesion(BONO, (await sesionNumero(BONO, 1)).id);
    const despues = await julio();

    expect(despues.horasTotales).toBe(antes.horasTotales - 1);
    expect(despues.facturacionTotal).toBeCloseTo(antes.facturacionTotal - 45, 2);
  });

  it("el precio medio se recalcula", async () => {
    await siete();
    await eliminarSesion(BONO, (await sesionNumero(BONO, 1)).id);
    const mes = await julio();

    expect(mes.precioMedioHora).toBeCloseTo(mes.facturacionTotal / mes.horasTotales, 4);
  });

  it("la sesión se quita del mes al que pertenecía", async () => {
    await siete();
    await firmarSesion(BONO, { fecha: "2026-08-04" });
    const julioAntes = await julio();

    const deAgosto = (await repositorio().listarSesiones(BONO)).find((s) => s.fecha.startsWith("2026-08"))!;
    await eliminarSesion(BONO, deAgosto.id);

    expect((await julio()).facturacionTotal).toBeCloseTo(julioAntes.facturacionTotal, 2);
    expect((await julio()).horasTotales).toBe(julioAntes.horasTotales);
  });

  it("borrar y volver a firmar deja todo como estaba", async () => {
    await siete();
    const antes = await julio();

    await eliminarSesion(BONO, (await sesionNumero(BONO, 7)).id);
    await firmarSesion(BONO, { fecha: "2026-07-29" });

    const despues = await julio();
    expect(despues.facturacionTotal).toBeCloseTo(antes.facturacionTotal, 2);
    expect(despues.horasTotales).toBe(antes.horasTotales);
    expect(await contador(BONO)).toBe(7);
  });

  it("en una cuenta de cliente también", async () => {
    await vaciar(CUENTA);
    for (const dia of ["01", "02", "03"]) await firmarSesion(CUENTA, { fecha: `2026-07-${dia}` });
    const antes = await julio();

    await eliminarSesion(CUENTA, (await sesionNumero(CUENTA, 2)).id);

    const despues = await julio();
    expect(despues.facturacionTotal).toBeCloseTo(antes.facturacionTotal - 35, 2);
    expect(despues.horasTotales).toBe(antes.horasTotales - 1);
    expect(await numeros(CUENTA)).toEqual([1, 2]);
  });

  it("en una mensualidad baja la hora pero no la cuota", async () => {
    await vaciar(MENSUAL);
    for (const dia of ["01", "02", "03"]) await firmarSesion(MENSUAL, { fecha: `2026-07-${dia}` });
    const antes = await julio();

    await eliminarSesion(MENSUAL, (await sesionNumero(MENSUAL, 2)).id);

    const despues = await julio();
    expect(despues.horasTotales).toBe(antes.horasTotales - 1);
    expect(despues.facturacionTotal).toBeCloseTo(antes.facturacionTotal, 2);
    expect(await numeros(MENSUAL)).toEqual([1, 2]);
  });
});

describe("reparación de lo ya descuadrado", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  /** Deja los números tal cual estaban en producción, sin renumerar. */
  async function romper(clienteId: string, numeros: number[], contadorRoto: number) {
    const repo = repositorio();
    const sesiones = (await repo.listarSesiones(clienteId)).sort((a, b) => a.fecha.localeCompare(b.fecha));
    for (const [i, sesion] of sesiones.entries()) {
      await repo.reubicarSesion(sesion.id, sesion.ciclo, numeros[i]);
    }
    const cliente = (await repo.obtenerCliente(clienteId))!;
    cliente.sesionesCompletadas = contadorRoto;
    await repo.actualizarCliente(cliente);
  }

  it("el caso Paquito: números que empiezan en dos", async () => {
    await vaciar(BONO);
    for (const dia of ["09", "10", "15", "17", "23", "29"]) {
      await firmarSesion(BONO, { fecha: `2026-07-${dia}` });
    }
    await romper(BONO, [2, 3, 4, 5, 6, 7], 7);

    await reparar();

    expect(await numeros(BONO)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await contador(BONO)).toBe(6);
  });

  it("el caso Nikki: huecos en medio y contador a cero", async () => {
    await vaciar(BONO);
    for (const dia of ["01", "02", "03", "06", "07", "08"]) {
      await firmarSesion(BONO, { fecha: `2026-07-${dia}` });
    }
    await romper(BONO, [1, 2, 3, 6, 7, 8], 0);

    await reparar();

    expect(await numeros(BONO)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await contador(BONO)).toBe(6);
  });

  it("el caso Rocío: más sesiones que el bono se reparte en ciclos", async () => {
    await vaciar(BONO);
    const repo = repositorio();
    for (const dia of ["01", "02", "03", "04", "05", "06", "07", "08", "09"]) {
      await firmarSesion(BONO, { fecha: `2026-06-${dia}` });
    }
    // Se fuerza el estado roto: las nueve en el ciclo 1.
    for (const sesion of await repo.listarSesiones(BONO)) {
      await repo.reubicarSesion(sesion.id, 1, sesion.numeroSesion);
    }
    const cliente = (await repo.obtenerCliente(BONO))!;
    cliente.cicloActual = 1;
    cliente.sesionesCompletadas = 1;
    await repo.actualizarCliente(cliente);

    await reparar();

    const perfil = await obtenerPerfil(BONO);
    const ciclos = perfil!.servicios;
    expect(ciclos.length).toBeGreaterThanOrEqual(2);
    const lleno = ciclos.find((c) => !c.esActual)!;
    const enCurso = ciclos.find((c) => c.esActual)!;
    expect(lleno.sesiones.length).toBe(8);
    expect(enCurso.sesiones.length).toBe(1);
    expect(await contador(BONO)).toBe(1);
  });

  it("no mueve la economía", async () => {
    await vaciar(BONO);
    for (const dia of ["09", "10", "15", "17", "23", "29"]) {
      await firmarSesion(BONO, { fecha: `2026-07-${dia}` });
    }
    await romper(BONO, [2, 3, 4, 5, 6, 7], 7);
    const antes = await julio();

    await reparar();

    const despues = await julio();
    expect(despues.facturacionTotal).toBeCloseTo(antes.facturacionTotal, 2);
    expect(despues.horasTotales).toBe(antes.horasTotales);
    expect(despues.precioMedioHora).toBeCloseTo(antes.precioMedioHora, 4);
  });

  it("es segura de repetir", async () => {
    await vaciar(BONO);
    for (const dia of ["09", "10", "15", "17"]) await firmarSesion(BONO, { fecha: `2026-07-${dia}` });
    await romper(BONO, [2, 3, 4, 5], 5);
    await reparar();

    const estado = { numeros: await numeros(BONO), contador: await contador(BONO), mes: await julio() };
    for (let i = 0; i < 3; i += 1) {
      await reparar();
      expect(await numeros(BONO)).toEqual(estado.numeros);
      expect(await contador(BONO)).toBe(estado.contador);
      expect((await julio()).facturacionTotal).toBeCloseTo(estado.mes.facturacionTotal, 2);
    }
  });

  it("no toca lo que ya está bien", async () => {
    await siete();
    expect(await diagnosticar()).toEqual([]);
  });

  it("el diagnóstico no escribe nada", async () => {
    await vaciar(BONO);
    for (const dia of ["09", "10", "15"]) await firmarSesion(BONO, { fecha: `2026-07-${dia}` });
    await romper(BONO, [2, 3, 4], 4);

    const antesNumeros = await numeros(BONO);
    const antesContador = await contador(BONO);
    await diagnosticar();

    expect(await numeros(BONO)).toEqual(antesNumeros);
    expect(await contador(BONO)).toBe(antesContador);
  });

  it("el diagnóstico dice qué filas cambiarían y su antes y después", async () => {
    await vaciar(BONO);
    for (const dia of ["09", "10", "15"]) await firmarSesion(BONO, { fecha: `2026-07-${dia}` });
    await romper(BONO, [2, 3, 4], 4);

    const [arreglo] = await diagnosticar();
    expect(arreglo.nombre).toBeTruthy();
    expect(arreglo.numerosAntes).toEqual([2, 3, 4]);
    expect(arreglo.numerosDespues).toEqual([1, 2, 3]);
    expect(arreglo.contadorAntes).toBe(4);
    expect(arreglo.contadorDespues).toBe(3);
    expect(arreglo.cambios).toHaveLength(3);
    for (const cambio of arreglo.cambios) {
      expect(cambio.sesionId).toBeTruthy();
      expect(cambio.numeroAntes).not.toBe(cambio.numeroDespues);
    }
  });
});

describe("vigilancia de coherencia", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("con los datos bien no informa de nada", async () => {
    await siete();
    expect(await comprobarCoherencia()).toEqual([]);
  });

  it("detecta un hueco en la numeración", async () => {
    await vaciar(BONO);
    for (const dia of ["01", "02", "03"]) await firmarSesion(BONO, { fecha: `2026-07-${dia}` });
    const repo = repositorio();
    const sesiones = (await repo.listarSesiones(BONO)).sort((a, b) => a.fecha.localeCompare(b.fecha));
    await repo.reubicarSesion(sesiones[2].id, sesiones[2].ciclo, 7);

    const problemas = await comprobarCoherencia();
    expect(problemas.some((p) => p.includes("huecos"))).toBe(true);
  });

  it("detecta que el marcador y el historial no coinciden", async () => {
    await siete();
    const repo = repositorio();
    const cliente = (await repo.obtenerCliente(BONO))!;
    cliente.sesionesCompletadas = 99;
    await repo.actualizarCliente(cliente);

    const problemas = await comprobarCoherencia();
    expect(problemas.some((p) => p.includes("marcador"))).toBe(true);
  });
});
