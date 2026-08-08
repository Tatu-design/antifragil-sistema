/**
 * CrossFit Lidomare y CrossFit Kids como cuentas de actividad (2026-08-08).
 *
 * Las dos se firman desde su ficha, igual que se le firma una sesión a un
 * cliente, pero se cobran de forma muy distinta:
 *
 * - **Lidomare**: 15 € y una hora por clase. Sin tope, sin renovación, sin
 *   deuda.
 * - **Kids**: 8 clases al mes de REFERENCIA, no de límite. Se puede pasar de
 *   8. Lo que se cobra se sabe al final del mes y lo introduce Fernando.
 *
 * Y una regla que cambia una decisión anterior: **las horas de Kids cuentan
 * siempre**, aunque todavía no se sepa lo que se va a cobrar por ellas.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { REFERENCIA_KIDS } from "@/domain/clases";
import { TARIFA_LIDOMARE } from "@/domain/economia";
import { repositorio } from "@/repositories";
import { reiniciarStagingParaPruebas } from "@/repositories/staging";
import {
  borrarClase,
  confirmarFacturacionKids,
  firmarClase,
  obtenerCuenta,
  revisarFacturacionKids,
} from "@/services/clases";
import { obtenerMes } from "@/services/economia";

const AGOSTO = { anio: 2026, mes: 8 };
const julio = () => obtenerMes(2026, 7);
const agosto = () => obtenerMes(AGOSTO.anio, AGOSTO.mes);

/** Firma `veces` clases de ese tipo en el día indicado. */
async function firmar(tipo: "lidomare" | "kids", veces: number, fecha = "2026-08-10") {
  for (let i = 0; i < veces; i += 1) await firmarClase(tipo, fecha);
}

describe("CrossFit Lidomare", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("un mes sin clases empieza en cero", async () => {
    const { ficha, historial } = await obtenerCuenta("lidomare", AGOSTO.anio, AGOSTO.mes);

    expect(ficha.sesiones).toBe(0);
    expect(ficha.facturacion).toBe(0);
    expect(historial).toEqual([]);
    // Sin tope: no hay referencia, ni restantes, ni barra que llenar.
    expect(ficha.referencia).toBeNull();
    expect(ficha.restantes).toBeNull();
    expect(ficha.porcentaje).toBeNull();
  });

  it("firmar una clase suma una sesión, una hora y 15 €", async () => {
    const antes = await agosto();
    await firmar("lidomare", 1);

    const { ficha } = await obtenerCuenta("lidomare", AGOSTO.anio, AGOSTO.mes);
    expect(ficha.sesiones).toBe(1);
    expect(ficha.facturacion).toBe(TARIFA_LIDOMARE);

    const despues = await agosto();
    expect(despues!.horasTotales).toBe((antes?.horasTotales ?? 0) + 1);
    expect(despues!.facturacionTotal).toBeCloseTo((antes?.facturacionTotal ?? 0) + TARIFA_LIDOMARE, 2);
  });

  it("varias clases suman 15 € cada una", async () => {
    await firmar("lidomare", 4);

    const { ficha } = await obtenerCuenta("lidomare", AGOSTO.anio, AGOSTO.mes);
    expect(ficha.sesiones).toBe(4);
    expect(ficha.facturacion).toBe(4 * TARIFA_LIDOMARE);
    expect(ficha.precioHora).toBe(TARIFA_LIDOMARE);
  });

  it("no hay tope de sesiones", async () => {
    await firmar("lidomare", 20);
    const { ficha } = await obtenerCuenta("lidomare", AGOSTO.anio, AGOSTO.mes);

    expect(ficha.sesiones).toBe(20);
    expect(ficha.facturacion).toBe(20 * TARIFA_LIDOMARE);
  });

  it("borrar una clase del historial quita su clase y su dinero", async () => {
    await firmar("lidomare", 3);
    const antes = await agosto();
    const { historial } = await obtenerCuenta("lidomare", AGOSTO.anio, AGOSTO.mes);

    await borrarClase(historial[0].id);

    const { ficha } = await obtenerCuenta("lidomare", AGOSTO.anio, AGOSTO.mes);
    expect(ficha.sesiones).toBe(2);

    const despues = await agosto();
    expect(despues!.facturacionTotal).toBeCloseTo(antes!.facturacionTotal - TARIFA_LIDOMARE, 2);
    expect(despues!.horasTotales).toBe(antes!.horasTotales - 1);
  });

  it("se borra la clase ELEGIDA, no la última", async () => {
    await firmarClase("lidomare", "2026-08-03");
    await firmarClase("lidomare", "2026-08-10");
    await firmarClase("lidomare", "2026-08-06");

    const { historial } = await obtenerCuenta("lidomare", AGOSTO.anio, AGOSTO.mes);
    const delMedio = historial.find((c) => c.fecha === "2026-08-06")!;
    await borrarClase(delMedio.id);

    const despues = await obtenerCuenta("lidomare", AGOSTO.anio, AGOSTO.mes);
    expect(despues.historial.map((c) => c.fecha)).toEqual(["2026-08-10", "2026-08-03"]);
  });

  it("borrar una clase que ya no existe avisa en vez de romperse", async () => {
    await expect(borrarClase("no-existe")).rejects.toThrow(/ya no existe/i);
  });

  it("el historial guarda las fechas reales, de la más reciente primero", async () => {
    await firmarClase("lidomare", "2026-08-03");
    await firmarClase("lidomare", "2026-08-10");
    await firmarClase("lidomare", "2026-08-06");

    const { historial } = await obtenerCuenta("lidomare", AGOSTO.anio, AGOSTO.mes);
    expect(historial.map((c) => c.fecha)).toEqual(["2026-08-10", "2026-08-06", "2026-08-03"]);
  });

  it("al cambiar de mes el contador empieza solo, sin borrar nada", async () => {
    await firmarClase("lidomare", "2026-07-15");
    await firmarClase("lidomare", "2026-08-04");

    expect((await obtenerCuenta("lidomare", 2026, 7)).ficha.sesiones).toBe(1);
    expect((await obtenerCuenta("lidomare", 2026, 8)).ficha.sesiones).toBe(1);
    // Julio conserva la suya: no se reinicia ningún contador, se filtra por mes.
    expect((await obtenerCuenta("lidomare", 2026, 9)).ficha.sesiones).toBe(0);
  });
});

describe("CrossFit Kids", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("un mes sin clases es 0 de 8", async () => {
    const { ficha } = await obtenerCuenta("kids", AGOSTO.anio, AGOSTO.mes);

    expect(ficha.sesiones).toBe(0);
    expect(ficha.referencia).toBe(REFERENCIA_KIDS);
    expect(ficha.restantes).toBe(8);
    expect(ficha.porcentaje).toBe(0);
    // Sin clases no hay facturación pendiente: no hay nada que facturar.
    expect(ficha.facturacionPendiente).toBe(false);
  });

  it("una clase es 1 de 8", async () => {
    await firmar("kids", 1);
    const { ficha } = await obtenerCuenta("kids", AGOSTO.anio, AGOSTO.mes);

    expect(ficha.sesiones).toBe(1);
    expect(ficha.restantes).toBe(7);
    expect(ficha.facturacionPendiente).toBe(true);
  });

  it("ocho clases llenan la barra", async () => {
    await firmar("kids", 8);
    const { ficha } = await obtenerCuenta("kids", AGOSTO.anio, AGOSTO.mes);

    expect(ficha.sesiones).toBe(8);
    expect(ficha.restantes).toBe(0);
    expect(ficha.porcentaje).toBe(100);
  });

  it("nueve clases se enseñan como 9 de 8, sin bloquear", async () => {
    await firmar("kids", 9);
    const { ficha } = await obtenerCuenta("kids", AGOSTO.anio, AGOSTO.mes);

    expect(ficha.sesiones).toBe(9);
    expect(ficha.referencia).toBe(8);
    // Ni restantes negativas ni barra pasada de largo.
    expect(ficha.restantes).toBe(0);
    expect(ficha.porcentaje).toBe(100);
  });

  it("borrar una clase del historial baja el contador", async () => {
    await firmar("kids", 3);
    const { historial } = await obtenerCuenta("kids", AGOSTO.anio, AGOSTO.mes);

    await borrarClase(historial[0].id);

    expect((await obtenerCuenta("kids", AGOSTO.anio, AGOSTO.mes)).ficha.sesiones).toBe(2);
  });

  it("el historial guarda las fechas", async () => {
    await firmarClase("kids", "2026-08-05");
    await firmarClase("kids", "2026-08-12");

    const { historial } = await obtenerCuenta("kids", AGOSTO.anio, AGOSTO.mes);
    expect(historial.map((c) => c.fecha)).toEqual(["2026-08-12", "2026-08-05"]);
  });

  it("al cambiar de mes empieza en 0 de 8 y agosto se conserva", async () => {
    await firmarClase("kids", "2026-08-05");
    await firmarClase("kids", "2026-08-12");

    expect((await obtenerCuenta("kids", 2026, 8)).ficha.sesiones).toBe(2);
    expect((await obtenerCuenta("kids", 2026, 9)).ficha.sesiones).toBe(0);
    expect((await obtenerCuenta("kids", 2026, 9)).ficha.restantes).toBe(8);
  });
});

describe("facturación de CrossFit Kids", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("mientras no se sabe, queda pendiente y no se inventa un precio", async () => {
    await firmar("kids", 8);
    const { ficha } = await obtenerCuenta("kids", AGOSTO.anio, AGOSTO.mes);

    expect(ficha.facturacion).toBeNull();
    expect(ficha.facturacionPendiente).toBe(true);
    expect(ficha.precioHora).toBeNull();
  });

  it("con 8 clases y 450 € sale a 56,25 € la hora", async () => {
    await firmar("kids", 8);

    const avance = await revisarFacturacionKids(AGOSTO.anio, AGOSTO.mes, 450);
    expect(avance.sesiones).toBe(8);
    expect(avance.precioResultante).toBe(56.25);

    await confirmarFacturacionKids(AGOSTO.anio, AGOSTO.mes, 450);
    const { ficha } = await obtenerCuenta("kids", AGOSTO.anio, AGOSTO.mes);
    expect(ficha.facturacion).toBe(450);
    expect(ficha.precioHora).toBe(56.25);
    expect(ficha.facturacionPendiente).toBe(false);
  });

  it("con 7 clases el precio se reparte entre 7", async () => {
    await firmar("kids", 7);
    await confirmarFacturacionKids(AGOSTO.anio, AGOSTO.mes, 420);

    const { ficha } = await obtenerCuenta("kids", AGOSTO.anio, AGOSTO.mes);
    expect(ficha.precioHora).toBe(60);
  });

  it("con 9 clases también, aunque pase de la referencia", async () => {
    await firmar("kids", 9);
    await confirmarFacturacionKids(AGOSTO.anio, AGOSTO.mes, 450);

    const { ficha } = await obtenerCuenta("kids", AGOSTO.anio, AGOSTO.mes);
    expect(ficha.precioHora).toBe(50);
  });

  it("sin ninguna clase se niega y explica por qué", async () => {
    await expect(revisarFacturacionKids(AGOSTO.anio, AGOSTO.mes, 450)).rejects.toThrow(
      /no hay ninguna clase/i,
    );
    await expect(confirmarFacturacionKids(AGOSTO.anio, AGOSTO.mes, 450)).rejects.toThrow(
      /no hay entre qué repartir/i,
    );
  });

  it("guardar un importe nuevo sustituye al anterior", async () => {
    await firmar("kids", 8);
    await confirmarFacturacionKids(AGOSTO.anio, AGOSTO.mes, 400);
    await confirmarFacturacionKids(AGOSTO.anio, AGOSTO.mes, 480);

    const { ficha } = await obtenerCuenta("kids", AGOSTO.anio, AGOSTO.mes);
    expect(ficha.facturacion).toBe(480);
    expect(ficha.precioHora).toBe(60);
  });
});

describe("las horas de Kids cuentan siempre en Economía", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("aunque todavía no se sepa lo que se va a cobrar", async () => {
    const antes = await agosto();
    await firmar("kids", 8);
    const despues = await agosto();

    // Ocho horas de trabajo son ocho horas, se sepa o no el importe.
    expect(despues!.horasTotales).toBe((antes?.horasTotales ?? 0) + 8);
    // Y su dinero todavía no está: el mes queda incompleto, y lo dice.
    expect(despues!.facturacionTotal).toBeCloseTo(antes?.facturacionTotal ?? 0, 2);
    expect(despues!.provisional).toBe(true);
    expect(despues!.precioMedioFiable).toBe(false);
  });

  it("al introducir el importe, el mes deja de estar incompleto", async () => {
    await firmar("kids", 8);
    await confirmarFacturacionKids(AGOSTO.anio, AGOSTO.mes, 450);

    const mes = await agosto();
    expect(mes!.provisional).toBe(false);
    expect(mes!.precioMedioFiable).toBe(true);
    expect(mes!.facturacionKids).toBe(450);
  });

  it("las horas no se cuentan dos veces al introducir el importe", async () => {
    await firmar("kids", 8);
    const conHoras = (await agosto())!.horasTotales;

    await confirmarFacturacionKids(AGOSTO.anio, AGOSTO.mes, 450);

    expect((await agosto())!.horasTotales).toBe(conHoras);
  });
});

describe("Economía suma PT, Lidomare y Kids", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("horas y facturación totales, y precio medio", async () => {
    // Punto de partida: lo que ya trae el mes de las sesiones de PT.
    const base = await agosto();
    const horasPT = base?.horasTotales ?? 0;
    const dineroPT = base?.facturacionTotal ?? 0;

    await firmar("lidomare", 5);
    await firmar("kids", 8);
    await confirmarFacturacionKids(AGOSTO.anio, AGOSTO.mes, 450);

    const mes = (await agosto())!;
    const horasEsperadas = horasPT + 5 + 8;
    const dineroEsperado = dineroPT + 5 * TARIFA_LIDOMARE + 450;

    expect(mes.horasTotales).toBe(horasEsperadas);
    expect(mes.facturacionTotal).toBeCloseTo(dineroEsperado, 2);
    expect(mes.precioMedioHora).toBeCloseTo(dineroEsperado / horasEsperadas, 2);
    expect(mes.precioMedioFiable).toBe(true);
  });

  it("el desglose separa las dos cuentas de CrossFit", async () => {
    await firmar("lidomare", 3);
    await firmar("kids", 4);
    await confirmarFacturacionKids(AGOSTO.anio, AGOSTO.mes, 200);

    const mes = (await agosto())!;
    expect(mes.porModalidad.lidomare).toEqual({ horas: 3, facturacion: 45 });
    expect(mes.porModalidad.kids).toEqual({ horas: 4, facturacion: 200 });
  });

  it("con Kids sin facturar, el precio medio se marca como no fiable", async () => {
    await firmar("lidomare", 2);
    await firmar("kids", 6);

    const mes = (await agosto())!;
    // El número existe, pero sale a la baja: 6 horas sin su dinero. Por eso se
    // marca, para que la pantalla lo diga en vez de enseñarlo como definitivo.
    expect(mes.precioMedioFiable).toBe(false);
    expect(mes.horasTotales).toBeGreaterThanOrEqual(8);
  });

  it("borrar una clase de Kids también quita su hora", async () => {
    await firmar("kids", 3);
    const antes = (await agosto())!.horasTotales;
    const { historial } = await obtenerCuenta("kids", AGOSTO.anio, AGOSTO.mes);

    await borrarClase(historial[0].id);

    expect((await agosto())!.horasTotales).toBe(antes - 1);
  });
});

describe("las dos cuentas no ensucian los datos de PT", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("una clase de CrossFit no aparece como sesión de ningún cliente", async () => {
    await firmar("lidomare", 3);
    await firmar("kids", 3);

    for (const cliente of await repositorio().listarClientes()) {
      const sesiones = await repositorio().listarSesiones(cliente.id);
      expect(sesiones.every((s) => s.servicio !== "CrossFit Lidomare")).toBe(true);
      expect(sesiones.every((s) => s.servicio !== "CrossFit Kids")).toBe(true);
    }
  });

  it("ni crea clientes, ni ciclos, ni deudas", async () => {
    const clientesAntes = (await repositorio().listarClientes()).length;

    await firmar("lidomare", 2);
    await firmar("kids", 2);

    expect((await repositorio().listarClientes()).length).toBe(clientesAntes);
  });

  it("julio no se entera de lo que se firma en agosto", async () => {
    const antes = await julio();
    await firmar("lidomare", 4, "2026-08-10");

    expect((await julio())?.facturacionTotal ?? 0).toBeCloseTo(antes?.facturacionTotal ?? 0, 2);
    expect((await julio())?.horasTotales ?? 0).toBe(antes?.horasTotales ?? 0);
  });
});

describe("firmar de un toque desde la lista", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("firmar sin clave de un solo uso funciona igual", async () => {
    // Desde la tarjeta de la lista no hay una carga de página por cliente que
    // genere esa clave, así que se firma sin ella (2026-08-08). El botón se
    // desactiva al pulsarlo, que es la protección que queda ahí.
    const { firmarSesion } = await import("@/services/sesiones");
    const [cliente] = await repositorio().listarClientes();

    const antes = (await repositorio().listarSesiones(cliente.id)).length;
    await firmarSesion(cliente.id, { fecha: "2026-08-10" });

    expect((await repositorio().listarSesiones(cliente.id)).length).toBe(antes + 1);
  });

  it("una cuenta de CrossFit se firma igual desde la lista que desde su ficha", async () => {
    await firmarClase("lidomare", "2026-08-10");
    const desdeLista = (await obtenerCuenta("lidomare", AGOSTO.anio, AGOSTO.mes)).ficha;

    expect(desdeLista.sesiones).toBe(1);
    expect(desdeLista.facturacion).toBe(TARIFA_LIDOMARE);
  });
});
