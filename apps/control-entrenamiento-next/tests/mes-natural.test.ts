/**
 * Una mensualidad es un MES NATURAL.
 *
 * NACE DE HORAS PERDIDAS DE VERDAD (2026-08-12). La mensualidad de julio de un
 * cliente se cerró el 23 y la de agosto no empezó hasta el 3. Entre medias
 * entrenaron el lunes 27 y el miércoles 29, y esas dos horas **no se pudieron
 * registrar**: al firmar se usaba siempre «el ciclo actual del cliente», que
 * para una mensualidad es el mes en curso.
 *
 * Desapareció trabajo real sin que nadie se enterara. Lo encontró Fernando
 * cuadrando su Excel, no el sistema.
 *
 * LA REGLA, en sus palabras:
 *
 *   «Julio va del 1 al 31 de julio. Aunque administrativamente el ciclo se
 *    cierre antes, las sesiones que se hagan hasta final de ese mes tienen que
 *    poder registrarse y pertenecer a esa mensualidad. No puede existir ningún
 *    hueco entre mensualidades que haga desaparecer horas reales.»
 */

import { beforeEach, describe, expect, it } from "vitest";

import { cicloDeLaFecha } from "@/domain/modalidades";
import { repositorio } from "@/repositories";
import { reiniciarStagingParaPruebas } from "@/repositories/staging";
import { obtenerEconomia } from "@/services/economia";
import { firmarSesion } from "@/services/sesiones";

const MENSUAL = "cli-b"; // mensualidad de 720 €

/** Los ciclos tal y como los mira la regla, sin lo que no le importa. */
const ciclo = (n: number, modalidad: string, anio: number | null, mes: number | null) =>
  ({ ciclo: n, modalidad, anio, mes }) as never;

describe("a qué programa pertenece una sesión", () => {
  const julio = ciclo(1, "mensualidad", 2026, 7);
  const agosto = ciclo(2, "mensualidad", 2026, 8);
  const ciclos = [julio, agosto];

  it("una sesión de julio es de la mensualidad de julio, aunque la actual sea agosto", () => {
    // El caso exacto que perdió las horas.
    expect(cicloDeLaFecha(ciclos, agosto, "2026-07-27")).toBe(julio);
    expect(cicloDeLaFecha(ciclos, agosto, "2026-07-29")).toBe(julio);
  });

  it("los últimos días del mes cuentan, aunque el ciclo se cerrara antes", () => {
    // El ciclo de julio tenía fecha de fin el 23. Da igual.
    for (const dia of ["2026-07-24", "2026-07-27", "2026-07-31"]) {
      expect(cicloDeLaFecha(ciclos, agosto, dia), dia).toBe(julio);
    }
  });

  it("el primer día del mes siguiente ya es del mes siguiente", () => {
    expect(cicloDeLaFecha(ciclos, agosto, "2026-08-01")).toBe(agosto);
  });

  it("un mes que no tuvo mensualidad no se inventa: se queda en el actual", () => {
    // Junio no existe como ciclo. No se crea uno de la nada.
    expect(cicloDeLaFecha(ciclos, agosto, "2026-06-15")).toBe(agosto);
  });

  it("un bono no se reparte por meses: siempre el suyo en curso", () => {
    const bono = ciclo(3, "bono", null, null);
    expect(cicloDeLaFecha([bono], bono, "2026-01-01")).toBe(bono);
    expect(cicloDeLaFecha([bono], bono, "2026-12-31")).toBe(bono);
  });

  it("sin ningún programa, no hay nada que elegir", () => {
    expect(cicloDeLaFecha([], null, "2026-07-27")).toBeNull();
  });
});

describe("firmar en los últimos días del mes", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("la sesión se guarda en el mes en que se hizo, no en el actual", async () => {
    const repo = repositorio();

    // Se cierra la mensualidad de julio el día 23 y se abre la de agosto,
    // exactamente como pasó de verdad.
    const actual = (await repo.listarCiclos(MENSUAL)).find((c) => c.ciclo === 1)!;
    await repo.guardarCiclo({ ...actual, anio: 2026, mes: 7, fechaInicio: "2026-07-01", fechaFin: "2026-07-23" });
    await repo.guardarCiclo({ ...actual, ciclo: 2, anio: 2026, mes: 8, fechaInicio: "2026-08-03", fechaFin: null, pagado: false });
    const cliente = (await repo.obtenerCliente(MENSUAL))!;
    await repo.actualizarCliente({ ...cliente, cicloActual: 2 });

    // Y ahora se firma una sesión del 27 de julio: el hueco.
    await firmarSesion(MENSUAL, { fecha: "2026-07-27" });

    const sesion = (await repo.listarSesiones(MENSUAL)).find((s) => s.fecha === "2026-07-27");
    expect(sesion, "la sesión del 27 de julio tiene que existir").toBeDefined();
    expect(sesion!.ciclo, "y pertenecer a la mensualidad de JULIO").toBe(1);
  });

  it("y cuenta como hora de julio, no de agosto", async () => {
    const repo = repositorio();
    const actual = (await repo.listarCiclos(MENSUAL)).find((c) => c.ciclo === 1)!;
    await repo.guardarCiclo({ ...actual, anio: 2026, mes: 7, fechaInicio: "2026-07-01", fechaFin: "2026-07-23" });
    await repo.guardarCiclo({ ...actual, ciclo: 2, anio: 2026, mes: 8, fechaInicio: "2026-08-03", fechaFin: null, pagado: false });
    const cliente = (await repo.obtenerCliente(MENSUAL))!;
    await repo.actualizarCliente({ ...cliente, cicloActual: 2 });

    const antes = (await obtenerEconomia()).anteriores.find((m) => m.anio === 2026 && m.mes === 7);
    await firmarSesion(MENSUAL, { fecha: "2026-07-27" });
    const despues = (await obtenerEconomia()).anteriores.find((m) => m.anio === 2026 && m.mes === 7)!;

    expect(despues.horasTotales).toBe((antes?.horasTotales ?? 0) + 1);
  });

  it("no añade dinero: en una mensualidad la cuota ya está cobrada", async () => {
    // «La facturación del mes son 720 €, hagan 6, 8, 9 o las que sean»
    // (Fernando, 2026-08-12).
    const repo = repositorio();
    const actual = (await repo.listarCiclos(MENSUAL)).find((c) => c.ciclo === 1)!;
    await repo.guardarCiclo({ ...actual, anio: 2026, mes: 7, fechaInicio: "2026-07-01", fechaFin: "2026-07-23" });

    const antes = (await obtenerEconomia()).anteriores.find((m) => m.anio === 2026 && m.mes === 7);
    await firmarSesion(MENSUAL, { fecha: "2026-07-27" });
    const despues = (await obtenerEconomia()).anteriores.find((m) => m.anio === 2026 && m.mes === 7)!;

    expect(despues.facturacionTotal).toBe(antes?.facturacionTotal ?? 0);
  });

  it("y no toca el contador del mes en curso", async () => {
    // La sesión es de julio: el «X sesiones este mes» de agosto no se mueve.
    const repo = repositorio();
    const actual = (await repo.listarCiclos(MENSUAL)).find((c) => c.ciclo === 1)!;
    await repo.guardarCiclo({ ...actual, anio: 2026, mes: 7, fechaFin: "2026-07-23" });
    await repo.guardarCiclo({ ...actual, ciclo: 2, anio: 2026, mes: 8, fechaInicio: "2026-08-03", fechaFin: null, pagado: false });
    const cliente = (await repo.obtenerCliente(MENSUAL))!;
    await repo.actualizarCliente({ ...cliente, cicloActual: 2 });

    const antes = (await repo.obtenerCliente(MENSUAL))!.sesionesCompletadas;
    await firmarSesion(MENSUAL, { fecha: "2026-07-27" });

    expect((await repo.obtenerCliente(MENSUAL))!.sesionesCompletadas).toBe(antes);
  });

  it("una sesión de hoy sigue yendo al mes en curso, como siempre", async () => {
    // Lo de siempre no se puede haber roto arreglando esto.
    const repo = repositorio();
    const cliente = (await repo.obtenerCliente(MENSUAL))!;
    const hoy = new Date().toISOString().slice(0, 10);

    await firmarSesion(MENSUAL, { fecha: hoy });

    const sesion = (await repo.listarSesiones(MENSUAL)).find((s) => s.fecha === hoy);
    expect(sesion!.ciclo).toBe(cliente.cicloActual);
  });
});
