/**
 * Las reglas de negocio portadas, comprobadas contra los mismos números que
 * usan los escenarios del sistema Python (`tests/fixtures/escenarios.json`).
 *
 * Estas pruebas no montan servidor ni repositorio: son las reglas puras.
 */

import { describe, expect, it } from "vitest";

import { fichaServicio, datosQueFaltan, puedeFirmarse } from "@/domain/ficha";
import {
  BONO,
  CUENTA,
  ErrorDeNegocio,
  MENSUALIDAD,
  consumeSesiones,
  etiquetaPago,
  precioEfectivo,
  tarifaDeLaSesion,
  tieneTope,
  validarCondiciones,
} from "@/domain/modalidades";
import { procesarUnaSesion } from "@/domain/programas";
import type { Ciclo } from "@/domain/tipos";

const cicloBono = (extra: Partial<Ciclo> = {}): Ciclo => ({
  clienteId: "c1",
  ciclo: 1,
  modalidad: BONO,
  servicio: "Bono 8",
  tarifa: 45,
  sesionesTotales: 8,
  precioTotal: 360,
  cuotaMensual: null,
  sesionesReferencia: null,
  anio: null,
  mes: null,
  fechaInicio: null,
  fechaFin: null,
  pagado: true,
  ...extra,
});

describe("condiciones de cada modalidad", () => {
  it("un bono calcula el precio por sesión desde el total (E01)", () => {
    expect(validarCondiciones(BONO, { sesionesTotales: 8, precioTotal: 360 }).tarifa).toBe(45);
  });

  it("100 € entre 3 sesiones son 33,33 € (E18)", () => {
    expect(validarCondiciones(BONO, { sesionesTotales: 3, precioTotal: 100 }).tarifa).toBe(33.33);
  });

  it("un bono no puede llevar cuota mensual", () => {
    expect(() => validarCondiciones(BONO, { sesionesTotales: 8, precioTotal: 360, cuotaMensual: 720 })).toThrow(
      ErrorDeNegocio,
    );
  });

  it("una mensualidad no puede tener tope de sesiones", () => {
    expect(() => validarCondiciones(MENSUALIDAD, { cuotaMensual: 720, sesionesTotales: 12 })).toThrow(
      ErrorDeNegocio,
    );
  });

  it("una mensualidad no lleva tarifa por sesión: sus sesiones no aportan dinero", () => {
    expect(validarCondiciones(MENSUALIDAD, { cuotaMensual: 720 }).tarifa).toBeNull();
  });

  it("una cuenta no tiene tope ni cuota", () => {
    const condiciones = validarCondiciones(CUENTA, { tarifa: 35 });
    expect(condiciones.sesionesTotales).toBeNull();
    expect(condiciones.tarifa).toBe(35);
  });

  it("un bono sin precio se rechaza", () => {
    expect(() => validarCondiciones(BONO, { sesionesTotales: 8 })).toThrow(ErrorDeNegocio);
  });
});

describe("consumo y renovación de un bono", () => {
  it("firmar descuenta exactamente una sesión (E01)", () => {
    const { numeroSesion, paso } = procesarUnaSesion({
      sesionesRestantes: 8,
      sesionesTotales: 8,
      pendientePago: false,
    });
    expect(numeroSesion).toBe(1);
    expect(paso.renovado).toBe(false);
    expect(paso.sesionesRestantes).toBe(7);
  });

  it("la última sesión renueva, y su número es el total, no el 1 del nuevo (E02)", () => {
    const { numeroSesion, paso } = procesarUnaSesion({
      sesionesRestantes: 1,
      sesionesTotales: 4,
      pendientePago: false,
    });
    expect(numeroSesion).toBe(4);
    expect(paso.renovado).toBe(true);
    expect(paso.sesionesRestantes).toBe(4);
  });

  it("el ciclo nuevo nace pendiente de pago (E04)", () => {
    const { paso } = procesarUnaSesion({ sesionesRestantes: 1, sesionesTotales: 4, pendientePago: false });
    expect(paso.pendientePago).toBe(true);
  });

  it("avisa cuando queda una sola sesión", () => {
    const { paso } = procesarUnaSesion({ sesionesRestantes: 2, sesionesTotales: 8, pendientePago: false });
    expect(paso.avisoUltimaSesion).toBe(true);
  });

  it("solo el bono consume saldo y renueva por consumo", () => {
    expect(consumeSesiones(BONO)).toBe(true);
    expect(consumeSesiones(MENSUALIDAD)).toBe(false);
    expect(consumeSesiones(CUENTA)).toBe(false);
    expect(tieneTope(CUENTA)).toBe(false);
  });
});

describe("dinero producido ≠ horas trabajadas", () => {
  it("la sesión de una mensualidad no lleva importe (E23)", () => {
    expect(tarifaDeLaSesion(MENSUALIDAD, 60)).toBeNull();
  });

  it("la de un bono o una cuenta sí", () => {
    expect(tarifaDeLaSesion(BONO, 45)).toBe(45);
    expect(tarifaDeLaSesion(CUENTA, 35)).toBe(35);
  });

  it("el precio efectivo de una cuota cambia con las sesiones hechas", () => {
    expect(precioEfectivo(720, 12)).toBe(60);
    expect(precioEfectivo(720, 9)).toBe(80);
    expect(precioEfectivo(720, 13)).toBe(55.38);
  });

  it("sin sesiones no hay división por cero", () => {
    expect(precioEfectivo(720, 0)).toBeNull();
  });
});

describe("la ficha decide, la pantalla pinta", () => {
  it("un bono enseña restantes y barra", () => {
    const ficha = fichaServicio({ ciclo: cicloBono(), sesionesDelCiclo: 6, sesionesCompletadas: 6 });
    expect(ficha.sesionesRestantes).toBe(2);
    expect(ficha.muestraBarra).toBe(true);
    expect(ficha.facturacion).toBe(270);
  });

  it("una mensualidad no habla de restantes ni de barra", () => {
    const ciclo = cicloBono({ modalidad: MENSUALIDAD, tarifa: null, sesionesTotales: 0, cuotaMensual: 720 });
    const ficha = fichaServicio({ ciclo, sesionesDelCiclo: 3 });
    expect(ficha.sesionesRestantes).toBeNull();
    expect(ficha.muestraBarra).toBe(false);
    expect(ficha.facturacion).toBe(720);
    expect(ficha.precioEfectivo).toBe(240);
  });

  it("se puede firmar en las tres modalidades: 0 sesiones NO significa «sin servicio»", () => {
    // Es el fallo exacto del 2026-08-04: `sesionesTotales` vale 0 en
    // mensualidad y cuenta, y una condición lo tomaba como falso.
    const mensual = cicloBono({ modalidad: MENSUALIDAD, tarifa: null, sesionesTotales: 0, cuotaMensual: 720 });
    const cuenta = cicloBono({ modalidad: CUENTA, tarifa: 35, sesionesTotales: 0 });
    expect(puedeFirmarse(cicloBono(), "activo")).toBe(true);
    expect(puedeFirmarse(mensual, "activo")).toBe(true);
    expect(puedeFirmarse(cuenta, "activo")).toBe(true);
  });

  it("un cliente pausado o cancelado no puede firmar", () => {
    expect(puedeFirmarse(cicloBono(), "pausado")).toBe(false);
    expect(puedeFirmarse(cicloBono(), "cancelado")).toBe(false);
  });

  it("cuando falta un dato, dice cuál", () => {
    const sinCuota = cicloBono({ modalidad: MENSUALIDAD, tarifa: null, sesionesTotales: 0, cuotaMensual: null });
    expect(datosQueFaltan(sinCuota)).toEqual(["la cuota mensual"]);
    expect(puedeFirmarse(sinCuota, "activo")).toBe(false);
  });

  it("cada modalidad se llama por su nombre", () => {
    expect(etiquetaPago(BONO, false)).toBe("Bono pagado");
    expect(etiquetaPago(MENSUALIDAD, false)).toBe("Mensualidad pagada");
    expect(etiquetaPago(CUENTA, false)).toBe("Cuenta pagada");
  });
});
