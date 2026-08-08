/**
 * La pantalla de Economía, simplificada (2026-08-08).
 *
 * Responde a una sola pregunta: cómo va la producción cada mes. Tres cifras
 * por mes —facturación, horas y € por hora— y nada más: fuera la semana, el
 * desglose por modalidades, las cuotas y los ajustes.
 *
 * Lo que se comprueba aquí es sobre todo aritmética:
 *
 *   horas       = todas las horas reales del mes
 *   facturación = todo el dinero conocido del mes
 *   € / hora    = facturación ÷ horas, SOLO cuando el dato es fiable
 */

import { beforeEach, describe, expect, it } from "vitest";

import { TARIFA_LIDOMARE } from "@/domain/economia";
import { hoyNegocio } from "@/lib/fechas";
import { repositorio } from "@/repositories";
import { reiniciarStagingParaPruebas } from "@/repositories/staging";
import { confirmarFacturacionKids, firmarClase } from "@/services/clases";
import { obtenerEconomia } from "@/services/economia";
import { firmarSesion } from "@/services/sesiones";

const HOY = hoyNegocio();
const ANIO = Number(HOY.slice(0, 4));
const MES = Number(HOY.slice(5, 7));

/** Deja el mes en curso completamente vacío, para partir de cero de verdad. */
async function vaciarMesActual() {
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
  // Las cuotas de mensualidad también son dinero del mes.
  for (const cliente of await repo.listarClientes()) {
    const cargo = await repo.cargoDelMes(cliente.id, ANIO, MES);
    if (cargo) await repo.guardarCargo({ ...cargo, importe: 0 });
  }
}

const economia = () => obtenerEconomia();

describe("el mes en curso", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("existe aunque no haya nada registrado, y no divide por cero", async () => {
    await vaciarMesActual();
    const { mesActual } = await economia();

    expect(mesActual.anio).toBe(ANIO);
    expect(mesActual.mes).toBe(MES);
    expect(mesActual.facturacionTotal).toBe(0);
    expect(mesActual.horasTotales).toBe(0);
    // Sin horas no hay media: la pantalla enseña un guion, no un número.
    expect(mesActual.precioMedioHora).toBe(0);
  });

  it("con sesiones de PT suma sus horas y su dinero", async () => {
    await vaciarMesActual();
    await firmarSesion("cli-a", { fecha: HOY }); // bono de 45 €

    const { mesActual } = await economia();
    expect(mesActual.horasTotales).toBe(1);
    expect(mesActual.facturacionTotal).toBe(45);
    expect(mesActual.precioMedioHora).toBe(45);
    expect(mesActual.precioMedioFiable).toBe(true);
  });

  it("PT más Lidomare", async () => {
    await vaciarMesActual();
    await firmarSesion("cli-a", { fecha: HOY });
    await firmarClase("lidomare", HOY);
    await firmarClase("lidomare", HOY);

    const { mesActual } = await economia();
    expect(mesActual.horasTotales).toBe(3);
    expect(mesActual.facturacionTotal).toBe(45 + 2 * TARIFA_LIDOMARE);
    expect(mesActual.precioMedioHora).toBeCloseTo((45 + 30) / 3, 2);
  });

  it("PT más Lidomare más Kids, con Kids ya facturado", async () => {
    await vaciarMesActual();
    await firmarSesion("cli-a", { fecha: HOY });
    await firmarClase("lidomare", HOY);
    for (let i = 0; i < 4; i += 1) await firmarClase("kids", HOY);
    await confirmarFacturacionKids(ANIO, MES, 200);

    const { mesActual } = await economia();
    const horas = 1 + 1 + 4;
    const dinero = 45 + TARIFA_LIDOMARE + 200;

    expect(mesActual.horasTotales).toBe(horas);
    expect(mesActual.facturacionTotal).toBe(dinero);
    expect(mesActual.precioMedioHora).toBeCloseTo(dinero / horas, 2);
    expect(mesActual.precioMedioFiable).toBe(true);
  });

  it("con Kids sin facturar: las horas cuentan y el precio medio no es fiable", async () => {
    await vaciarMesActual();
    await firmarSesion("cli-a", { fecha: HOY });
    for (let i = 0; i < 4; i += 1) await firmarClase("kids", HOY);

    const { mesActual } = await economia();

    // Cinco horas trabajadas de verdad: una de PT y cuatro de Kids.
    expect(mesActual.horasTotales).toBe(5);
    // Pero el dinero de Kids todavía no está.
    expect(mesActual.facturacionTotal).toBe(45);
    expect(mesActual.precioMedioFiable).toBe(false);
  });

  it("al introducir el importe de Kids el mes deja de ser provisional", async () => {
    await vaciarMesActual();
    for (let i = 0; i < 4; i += 1) await firmarClase("kids", HOY);
    expect((await economia()).mesActual.precioMedioFiable).toBe(false);

    await confirmarFacturacionKids(ANIO, MES, 200);

    const { mesActual } = await economia();
    expect(mesActual.precioMedioFiable).toBe(true);
    expect(mesActual.facturacionTotal).toBe(200);
    expect(mesActual.precioMedioHora).toBe(50);
  });

  it("firmar una sesión más se refleja al momento", async () => {
    await vaciarMesActual();
    await firmarSesion("cli-a", { fecha: HOY });
    const antes = (await economia()).mesActual;

    await firmarSesion("cli-a", { fecha: HOY });

    const despues = (await economia()).mesActual;
    expect(despues.horasTotales).toBe(antes.horasTotales + 1);
    expect(despues.facturacionTotal).toBe(antes.facturacionTotal + 45);
  });
});

describe("los meses anteriores", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("no incluyen el mes en curso", async () => {
    const { mesActual, anteriores } = await economia();
    expect(anteriores.some((m) => m.anio === mesActual.anio && m.mes === mesActual.mes)).toBe(false);
  });

  it("van del más reciente al más antiguo", async () => {
    await firmarSesion("cli-a", { fecha: "2026-05-04" });
    await firmarSesion("cli-a", { fecha: "2026-07-06" });
    await firmarSesion("cli-a", { fecha: "2026-06-08" });

    const { anteriores } = await economia();
    const claves = anteriores.map((m) => m.anio * 100 + m.mes);
    expect([...claves].sort((a, b) => b - a)).toEqual(claves);
  });

  it("un mes anterior completo trae sus tres cifras", async () => {
    const { anteriores } = await economia();
    const julio = anteriores.find((m) => m.anio === 2026 && m.mes === 7)!;

    expect(julio.horasTotales).toBeGreaterThan(0);
    expect(julio.facturacionTotal).toBeGreaterThan(0);
    expect(julio.precioMedioHora).toBeCloseTo(julio.facturacionTotal / julio.horasTotales, 2);
  });

  it("un mes anterior con Kids sin facturar queda marcado como provisional", async () => {
    await firmarClase("kids", "2026-06-10");

    const { anteriores } = await economia();
    const junio = anteriores.find((m) => m.anio === 2026 && m.mes === 6)!;

    expect(junio.precioMedioFiable).toBe(false);
    // Su hora cuenta igual, aunque no se sepa lo que se cobró.
    expect(junio.horasTotales).toBeGreaterThan(0);
  });

  it("cambiar de mes deja el anterior intacto y empieza el nuevo", async () => {
    await firmarClase("lidomare", "2026-06-10");
    const { anteriores } = await economia();

    const junio = anteriores.find((m) => m.anio === 2026 && m.mes === 6)!;
    const julio = anteriores.find((m) => m.anio === 2026 && m.mes === 7)!;

    // Cada mes cuenta lo suyo: la clase de junio no aparece en julio.
    expect(junio.horasTotales).toBeGreaterThan(0);
    expect(julio.anio).toBe(2026);
    expect(junio.mes).toBe(6);
  });
});

describe("la pantalla no pide lo que ya no enseña", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("ni las semanas ni las clases de esta semana", async () => {
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

  it("y consultarla sigue sin escribir nada", async () => {
    const antes = JSON.stringify(await repositorio().listarSemanas());
    await obtenerEconomia();
    await obtenerEconomia();
    expect(JSON.stringify(await repositorio().listarSemanas())).toBe(antes);
  });
});
