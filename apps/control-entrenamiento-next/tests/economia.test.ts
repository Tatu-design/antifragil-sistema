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
import { hoyNegocio } from "@/lib/fechas";
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

  it("el mes en curso existe siempre, aunque no haya nada firmado", async () => {
    // Desde el 2026-08-08 la pantalla enseña su bloque en cero el día 1, no un
    // hueco. Se comprueba con un mes futuro, que no tiene nada.
    const { mesActual } = await obtenerEconomia();
    expect(mesActual).toBeDefined();
    expect(mesActual.anio).toBeGreaterThan(2000);
    expect(typeof mesActual.facturacionTotal).toBe("number");
    expect(typeof mesActual.horasTotales).toBe("number");
  });

  it("una firma aparece en el mes en curso", async () => {
    const hoy = hoyNegocio();
    await firmarSesion("cli-a", { fecha: hoy });

    const { mesActual } = await obtenerEconomia();
    expect(mesActual.horasTotales).toBeGreaterThan(0);
  });

  it("los meses anteriores van del más reciente al más antiguo, sin el actual", async () => {
    await firmarSesion("cli-a", { fecha: "2026-07-31" });
    await firmarSesion("cli-a", { fecha: "2026-06-10" });

    const { mesActual, anteriores } = await obtenerEconomia();

    // El mes en curso no se repite abajo.
    expect(anteriores.some((m) => m.anio === mesActual.anio && m.mes === mesActual.mes)).toBe(false);

    // Y el orden es del más reciente al más antiguo.
    const claves = anteriores.map((m) => m.anio * 100 + m.mes);
    expect([...claves].sort((a, b) => b - a)).toEqual(claves);
  });

  it("el mes reparte por fecha real, no por semanas", async () => {
    await firmarSesion("cli-a", { fecha: "2026-07-31" }); // viernes
    await firmarSesion("cli-a", { fecha: "2026-08-01" }); // sábado, misma semana

    const { anteriores } = await obtenerEconomia();
    const julio = anteriores.find((m) => m.anio === 2026 && m.mes === 7)!;

    // 9 sesiones de partida en julio + la del 31.
    expect(julio.horasTotales).toBe(9 + 1);
  });

  it("ya no se piden las semanas ni las clases de la semana", async () => {
    // La pantalla dejó de enseñarlas (2026-08-08), así que pedirlas serían dos
    // viajes de red para nada.
    const repo = repositorio() as unknown as Record<string, unknown>;
    const llamadas: string[] = [];
    for (const nombre of ["listarSemanas", "contarClases"]) {
      const original = repo[nombre] as (...a: unknown[]) => unknown;
      repo[nombre] = (...args: unknown[]) => {
        llamadas.push(nombre);
        return original.apply(repo, args);
      };
    }

    await obtenerEconomia();

    expect(llamadas).toEqual([]);
  });
});
