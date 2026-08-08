/**
 * Las reglas del dinero.
 *
 * Los números vienen de los escenarios del sistema Python
 * (`tests/fixtures/escenarios.json`), para que las dos aplicaciones digan lo
 * mismo al céntimo.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { TARIFA_LIDOMARE, precioClaseKids, resumirMes, resumirSemana } from "@/domain/economia";
import { BONO, CUENTA, MENSUALIDAD, type Modalidad } from "@/domain/modalidades";
import { repositorio } from "@/repositories";
import { reiniciarStagingParaPruebas } from "@/repositories/staging";
import { deshacerClase, guardarFacturacionKids, obtenerEconomia, registrarClase } from "@/services/economia";
import { firmarSesion } from "@/services/sesiones";

const sesion = (tarifa: number | null, modalidad: Modalidad) => ({
  fecha: "2026-08-03",
  tarifa,
  modalidad,
});

const mesVacio = {
  anio: 2026,
  mes: 8,
  sesiones: [],
  cuotas: [],
  clasesLidomare: 0,
  clasesKids: 0,
  facturacionKids: null,
  ajustes: [],
};

describe("el resumen de un mes", () => {
  it("suma las sesiones con importe (E01: 3 × 45 = 135)", () => {
    const r = resumirMes({
      ...mesVacio,
      sesiones: Array.from({ length: 3 }, () => ({ fecha: "2026-08-03", tarifa: 45, modalidad: BONO })),
    });
    expect(r.facturacionTotal).toBe(135);
    expect(r.horasTotales).toBe(3);
    expect(r.precioMedioHora).toBe(45);
  });

  it("un bono de 100 € entre 3 factura 99,99, no 100 (E18)", () => {
    const r = resumirMes({
      ...mesVacio,
      sesiones: Array.from({ length: 3 }, () => ({ fecha: "2026-08-03", tarifa: 33.33, modalidad: BONO })),
    });
    expect(r.facturacionTotal).toBe(99.99);
  });

  it("una mensualidad factura su cuota, y sus sesiones solo suman horas (E23)", () => {
    const r = resumirMes({
      ...mesVacio,
      sesiones: Array.from({ length: 3 }, () => ({
        fecha: "2026-08-03",
        tarifa: null,
        modalidad: MENSUALIDAD,
      })),
      cuotas: [720],
    });
    expect(r.facturacionTotal).toBe(720);
    expect(r.horasTotales).toBe(3);
    expect(r.precioMedioHora).toBe(240);
    expect(r.facturacionCuotas).toBe(720);
    expect(r.porModalidad.mensualidad).toEqual({ horas: 3, facturacion: 720 });
  });

  it("suma las tres modalidades a la vez", () => {
    const r = resumirMes({
      ...mesVacio,
      sesiones: [
        ...Array.from({ length: 2 }, () => sesion(45, BONO)),
        ...Array.from({ length: 3 }, () => sesion(null, MENSUALIDAD)),
        ...Array.from({ length: 4 }, () => sesion(35, CUENTA)),
      ],
      cuotas: [720],
    });
    expect(r.facturacionTotal).toBe(90 + 720 + 140);
    expect(r.horasTotales).toBe(9);
  });

  it("CrossFit Lidomare cuenta a tarifa fija (E13)", () => {
    const r = resumirMes({ ...mesVacio, clasesLidomare: 3 });
    expect(r.facturacionTotal).toBe(45);
    expect(r.horasTotales).toBe(3);
    expect(r.precioMedioHora).toBe(TARIFA_LIDOMARE);
  });

  it("las horas de Kids cuentan aunque no se sepa aún su importe (E14)", () => {
    // Cambio de criterio de Fernando, 2026-08-08. Antes las horas de Kids no
    // contaban hasta conocer la facturación, para que el precio medio no
    // saliera hundido. El problema es que eso escondía trabajo real: una clase
    // de Kids es una hora trabajada, se sepa o no lo que se va a cobrar.
    //
    // La solución al precio medio no es esconder horas, es avisar de que el
    // mes aún está incompleto — eso hace `precioMedioFiable`.
    const r = resumirMes({ ...mesVacio, clasesKids: 4 });
    expect(r.horasTotales).toBe(4);
    expect(r.facturacionTotal).toBe(0);
    expect(r.sesionesKids).toBe(4);
    expect(r.provisional).toBe(true);
    expect(r.precioMedioFiable).toBe(false);
  });

  it("al introducir el importe, Kids deja de ser provisional (E14b)", () => {
    const r = resumirMes({ ...mesVacio, clasesKids: 4, facturacionKids: 800 });
    expect(r.provisional).toBe(false);
    expect(r.facturacionTotal).toBe(800);
    expect(r.horasTotales).toBe(4);
    expect(r.precioMedioHora).toBe(200);
  });

  it("un ajuste histórico se suma y se ve por separado (E25)", () => {
    const r = resumirMes({
      ...mesVacio,
      mes: 7,
      sesiones: [{ fecha: "2026-07-29", tarifa: 37.5, modalidad: BONO }],
      ajustes: [{ origen: "legacy", importe: 112.5, horas: 3, motivo: "Sesiones sin fecha registrada" }],
    });
    expect(r.facturacionTotal).toBe(150);
    expect(r.horasTotales).toBe(4);
    expect(r.ajusteImporte).toBe(112.5);
    expect(r.ajustes[0]!.motivo).toContain("sin fecha");
  });

  it("un mes vacío no divide por cero", () => {
    expect(resumirMes(mesVacio).precioMedioHora).toBe(0);
  });
});

describe("el resumen de una semana", () => {
  it("las horas de una mensualidad cuentan aunque no aporten dinero (H-01)", () => {
    const r = resumirSemana({
      inicio: "2026-08-03",
      fin: "2026-08-09",
      facturacion: 45,
      horas: 1,
      horasSinImporte: 3,
      sesionesKids: 0,
      facturacionKids: null,
    });
    expect(r.facturacionTotal).toBe(45);
    expect(r.horasTotales).toBe(4);
    expect(r.precioMedioHora).toBe(11.25);
  });

  it("es provisional mientras falte el importe de Kids", () => {
    const r = resumirSemana({
      inicio: "2026-08-03",
      fin: "2026-08-09",
      facturacion: 0,
      horas: 0,
      horasSinImporte: 0,
      sesionesKids: 2,
      facturacionKids: null,
    });
    expect(r.provisional).toBe(true);
    expect(r.horasTotales).toBe(0);
  });
});

describe("el precio por clase de Kids", () => {
  it("es su importe entre las clases de SU mes", () => {
    expect(precioClaseKids(800, 4)).toBe(200);
  });

  it("sin importe o sin clases devuelve cero, no infinito", () => {
    expect(precioClaseKids(null, 4)).toBe(0);
    expect(precioClaseKids(800, 0)).toBe(0);
  });
});

describe("clases de grupo, de punta a punta", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("sumar una clase de Lidomare la mete en la semana y en el mes", async () => {
    await registrarClase("lidomare", "2026-08-03");
    const semana = (await repositorio().listarSemanas()).find((s) => s.inicio === "2026-08-03")!;
    expect(semana.facturacion).toBe(TARIFA_LIDOMARE);
    expect(semana.horas).toBe(1);
  });

  it("deshacerla lo revierte entero", async () => {
    await registrarClase("lidomare", "2026-08-03");
    await deshacerClase("lidomare");
    const semana = (await repositorio().listarSemanas()).find((s) => s.inicio === "2026-08-03");
    expect(semana?.facturacion ?? 0).toBe(0);
    expect(semana?.horas ?? 0).toBe(0);
  });

  it("deshacer sin ninguna clase avisa en vez de romper", async () => {
    await expect(deshacerClase("kids")).rejects.toThrow(/no hay ninguna clase/i);
  });

  it("una clase de Kids no suma dinero a la semana todavía", async () => {
    await registrarClase("kids", "2026-08-03");
    const semana = (await repositorio().listarSemanas()).find((s) => s.inicio === "2026-08-03")!;
    expect(semana.facturacion).toBe(0);
    expect(semana.sesionesKids).toBe(1);
  });

  it("al introducir la facturación de Kids se reparte entre sus clases", async () => {
    await registrarClase("kids", "2026-08-03");
    await registrarClase("kids", "2026-08-05");
    const precio = await guardarFacturacionKids(2026, 8, 400);
    expect(precio).toBe(200);
  });

  it("un importe que no sea positivo se rechaza", async () => {
    await expect(guardarFacturacionKids(2026, 8, 0)).rejects.toThrow(/positivo/i);
  });
});

describe("la pantalla de Economía", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("consultarla no escribe nada", async () => {
    const antes = JSON.stringify(await repositorio().listarSemanas());
    await obtenerEconomia();
    await obtenerEconomia();
    expect(JSON.stringify(await repositorio().listarSemanas())).toBe(antes);
  });

  it("una firma aparece en la semana y en su mes", async () => {
    await firmarSesion("cli-a", { fecha: "2026-08-03" });
    const { semanas, meses } = await obtenerEconomia();
    const semana = semanas.find((s) => s.inicio === "2026-08-03")!;
    const mes = meses.find((m) => m.anio === 2026 && m.mes === 8)!;
    expect(semana.facturacionTotal).toBe(45);
    // El mes suma además la cuota de la mensualidad de Cliente B, que se cobra
    // por tener las plazas reservadas y no por firmar sesiones.
    expect(mes.facturacionTotal).toBe(45 + 720);
  });

  it("una semana a caballo se muestra entera, pero el mes la reparte (E10 y E11)", async () => {
    await firmarSesion("cli-a", { fecha: "2026-07-31" }); // viernes
    await firmarSesion("cli-a", { fecha: "2026-08-01" }); // sábado, misma semana
    const { semanas, meses } = await obtenerEconomia();

    // Esa semana ya traía 3 sesiones de la situación de partida.
    const semana = semanas.find((s) => s.inicio === "2026-07-27")!;
    expect(semana.horasTotales).toBe(3 + 2);

    // Pero el mes las separa por su fecha real: una a julio y otra a agosto.
    const julio = meses.find((m) => m.mes === 7)!;
    const agosto = meses.find((m) => m.mes === 8)!;
    expect(julio.horasTotales).toBe(9 + 1); // 9 de partida + la del 31 de julio
    expect(agosto.horasTotales).toBe(1);
  });
});
