/**
 * La economía, mirada por profesional.
 *
 * **No hay una segunda economía.** Es la misma función con menos filas: si
 * algún día cambia una regla del dinero, cambia para todos a la vez porque
 * solo existe en un sitio. Lo que se prueba aquí es a QUIÉN pertenece cada
 * cosa, no cuánto suma —eso ya está en `economia.test.ts`.
 *
 * LA REGLA (Fernando, 2026-08-11)
 *
 * La producción es del profesional responsable DEL CLIENTE, no de quien firmó.
 * Si Fernando firma excepcionalmente una sesión de un cliente de Rafa, esa
 * sesión es producción de Rafa.
 *
 * Y no se reescribe hacia atrás: la sesión guarda de quién era el cliente
 * cuando se firmó, igual que ya guardaba su tarifa y su servicio.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { TARIFA_LIDOMARE } from "@/domain/economia";
import { hoyNegocio } from "@/lib/fechas";
import { repositorio } from "@/repositories";
import { reiniciarStagingParaPruebas } from "@/repositories/staging";
import { confirmarFacturacionKids, firmarClase } from "@/services/clases";
import { obtenerEconomia } from "@/services/economia";
import { firmarSesion } from "@/services/sesiones";

const ADMIN = "per-admin";
const RAFA = "per-rafa";
const OTRO = "per-otro";

const HOY = hoyNegocio();
const ANIO = Number(HOY.slice(0, 4));
const MES = Number(HOY.slice(5, 7));

const deAdmin = () => obtenerEconomia({ profesionalId: ADMIN, esAdministrador: true });
const deRafa = () => obtenerEconomia({ profesionalId: RAFA });
const deOtro = () => obtenerEconomia({ profesionalId: OTRO });

/** Deja el mes en curso vacío, para partir de cero de verdad. */
async function vaciarMesActual() {
  const repo = repositorio();
  const prefijo = HOY.slice(0, 7);
  for (const cliente of await repo.listarClientes()) {
    for (const sesion of await repo.listarSesiones(cliente.id)) {
      if (sesion.fecha.startsWith(prefijo)) await repo.eliminarSesion(sesion.id);
    }
    const cargo = await repo.cargoDelMes(cliente.id, ANIO, MES);
    if (cargo) await repo.guardarCargo({ ...cargo, importe: 0 });
  }
  for (const tipo of ["lidomare", "kids"] as const) {
    for (const clase of await repo.clasesDelMes(tipo, ANIO, MES)) await repo.borrarClase(clase.id);
  }
}

// ---------------------------------------------------------------------------
// A quién pertenece cada cosa
// ---------------------------------------------------------------------------

describe("de quién es cada producción", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("la sesión de un cliente cuenta para SU profesional", async () => {
    await vaciarMesActual();
    // «cli-a» es del administrador; «cli-d», de Rafa (35 €/sesión).
    await firmarSesion("cli-a", { fecha: HOY });
    await firmarSesion("cli-d", { fecha: HOY });

    expect((await deAdmin()).mesActual.facturacionTotal).toBe(45);
    expect((await deRafa()).mesActual.facturacionTotal).toBe(35);
  });

  it("SI EL ADMINISTRADOR FIRMA una sesión de un cliente de Rafa, es de Rafa", async () => {
    // Es el caso que Fernando puso como obligatorio. `firmadaPor` dice quién
    // pulsó; no cambia de quién es el dinero.
    await vaciarMesActual();
    await firmarSesion("cli-d", { fecha: HOY, firmadaPor: ADMIN });

    expect((await deRafa()).mesActual.facturacionTotal).toBe(35);
    expect((await deAdmin()).mesActual.facturacionTotal).toBe(0);
  });

  it("y al revés: si Rafa firma un cliente del administrador, es del administrador", async () => {
    await vaciarMesActual();
    await firmarSesion("cli-a", { fecha: HOY, firmadaPor: RAFA });

    expect((await deAdmin()).mesActual.facturacionTotal).toBe(45);
    expect((await deRafa()).mesActual.facturacionTotal).toBe(0);
  });

  it("la cuota de una mensualidad va al profesional de ese cliente", async () => {
    // «cli-b» es del administrador y tiene una cuota de 720 €.
    const conCuota = (await deAdmin()).mesActual.facturacionCuotas;
    expect(conCuota).toBe(720);
    expect((await deRafa()).mesActual.facturacionCuotas).toBe(0);
  });

  it("cada profesional ve solo lo suyo, también con tres", async () => {
    await vaciarMesActual();
    await firmarSesion("cli-a", { fecha: HOY }); // admin, 45
    await firmarSesion("cli-d", { fecha: HOY }); // rafa, 35
    // «cli-e» es del tercero, pero está pausado: se le reactiva para firmar.
    const repo = repositorio();
    const e = (await repo.obtenerCliente("cli-e"))!;
    await repo.actualizarCliente({ ...e, estado: "activo" });
    await firmarSesion("cli-e", { fecha: HOY }); // otro, 50

    // `vaciarMesActual` deja las cuotas a cero, así que aquí solo hay sesiones.
    expect((await deAdmin()).mesActual.facturacionTotal).toBe(45);
    expect((await deRafa()).mesActual.facturacionTotal).toBe(35);
    expect((await deOtro()).mesActual.facturacionTotal).toBe(50);
  });

  it("lo atribuido a cada uno suma lo mismo que el total", async () => {
    await vaciarMesActual();
    await firmarSesion("cli-a", { fecha: HOY });
    await firmarSesion("cli-d", { fecha: HOY });
    await firmarClase("lidomare", HOY);

    const total = (await obtenerEconomia()).mesActual.facturacionTotal;
    const suma =
      (await deAdmin()).mesActual.facturacionTotal +
      (await deRafa()).mesActual.facturacionTotal +
      (await deOtro()).mesActual.facturacionTotal;

    expect(suma).toBe(total);
  });
});

// ---------------------------------------------------------------------------
// CrossFit
// ---------------------------------------------------------------------------

describe("CrossFit es del administrador", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("Lidomare cuenta en su economía", async () => {
    await vaciarMesActual();
    await firmarClase("lidomare", HOY);

    expect((await deAdmin()).mesActual.facturacionTotal).toBe(TARIFA_LIDOMARE);
  });

  it("y NUNCA en la de un entrenador", async () => {
    await vaciarMesActual();
    await firmarClase("lidomare", HOY);
    for (let i = 0; i < 4; i += 1) await firmarClase("kids", HOY);
    await confirmarFacturacionKids(ANIO, MES, 200);

    const rafa = (await deRafa()).mesActual;
    expect(rafa.facturacionTotal).toBe(0);
    expect(rafa.horasTotales).toBe(0);
    expect(rafa.sesionesKids).toBe(0);
  });

  it("Kids sin facturar deja el mes del administrador como no fiable, no el de Rafa", async () => {
    await vaciarMesActual();
    for (let i = 0; i < 4; i += 1) await firmarClase("kids", HOY);

    expect((await deAdmin()).mesActual.precioMedioFiable).toBe(false);
    // A Rafa no le afecta: esas horas no son suyas.
    expect((await deRafa()).mesActual.precioMedioFiable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Meses
// ---------------------------------------------------------------------------

describe("los meses de cada profesional", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("un profesional sin actividad ve su mes en cero, no un hueco", async () => {
    await vaciarMesActual();
    const { mesActual } = await deRafa();

    expect(mesActual.anio).toBe(ANIO);
    expect(mesActual.mes).toBe(MES);
    expect(mesActual.facturacionTotal).toBe(0);
    expect(mesActual.horasTotales).toBe(0);
    // Sin horas no hay media: la pantalla enseña un guion.
    expect(mesActual.precioMedioHora).toBe(0);
  });

  it("y no ve meses anteriores que no son suyos", async () => {
    // El histórico de partida es todo del administrador.
    expect((await deRafa()).anteriores).toEqual([]);
    expect((await deAdmin()).anteriores.length).toBeGreaterThan(0);
  });

  it("los meses anteriores siguen yendo del más reciente al más antiguo", async () => {
    await firmarSesion("cli-d", { fecha: "2026-05-04" });
    await firmarSesion("cli-d", { fecha: "2026-07-06" });
    await firmarSesion("cli-d", { fecha: "2026-06-08" });

    const claves = (await deRafa()).anteriores.map((m) => m.anio * 100 + m.mes);
    expect([...claves].sort((a, b) => b - a)).toEqual(claves);
  });

  it("el mes en curso nunca se repite abajo", async () => {
    const { mesActual, anteriores } = await deAdmin();
    expect(anteriores.some((m) => m.anio === mesActual.anio && m.mes === mesActual.mes)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// El histórico cuando un cliente cambia de profesional
// ---------------------------------------------------------------------------

describe("si un cliente cambia de profesional", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("lo que produjo antes NO se reescribe", async () => {
    // Enero: «cli-a» es del administrador y entrena.
    await firmarSesion("cli-a", { fecha: "2026-01-15" });
    const eneroAntes = (await deAdmin()).anteriores.find((m) => m.mes === 1)!;
    expect(eneroAntes.facturacionTotal).toBe(45);

    // Febrero: pasa a Rafa, y entrena con él.
    await repositorio().asignarProfesional("cli-a", RAFA);
    await firmarSesion("cli-a", { fecha: "2026-02-10" });

    const admin = await deAdmin();
    const rafa = await deRafa();

    // Enero sigue siendo del administrador: la sesión guardó de quién era.
    expect(admin.anteriores.find((m) => m.mes === 1)?.facturacionTotal).toBe(45);
    // Y febrero es de Rafa.
    expect(rafa.anteriores.find((m) => m.mes === 2)?.facturacionTotal).toBe(45);
    // Enero NO aparece en la de Rafa.
    expect(rafa.anteriores.some((m) => m.mes === 1)).toBe(false);
  });

  it("las sesiones sin esa copia se atribuyen por el responsable de hoy", async () => {
    // Son las anteriores al 2026-08-11. Mientras el cliente no cambie de
    // manos —y hoy ninguno lo ha hecho— el resultado es idéntico al de antes.
    const repo = repositorio();
    const sesion = (await repo.listarSesiones("cli-a"))[0]!;
    expect(sesion.profesionalId ?? null).toBeNull();

    const julio = (await deAdmin()).anteriores.find((m) => m.mes === 7);
    expect(julio?.facturacionTotal).toBeGreaterThan(0);
    expect((await deRafa()).anteriores.some((m) => m.mes === 7)).toBe(false);
  });
});
