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
import { DESDE_QUE_HAY_PROFESIONALES, duenioDeLaSesion, puedeLlevarModalidad } from "@/domain/atribucion";
import { configurarServicio, crearCliente, traspasarCliente } from "@/services/clientes";
import { obtenerEconomia } from "@/services/economia";
import { firmarSesion } from "@/services/sesiones";

const ADMIN = "per-admin";
const RAFA = "per-rafa";
const OTRO = "per-otro";

const HOY = hoyNegocio();
const ANIO = Number(HOY.slice(0, 4));
const MES = Number(HOY.slice(5, 7));

// `adminId` va siempre: es quien se queda todo el histórico anterior a que
// existieran los profesionales.
const deAdmin = () => obtenerEconomia({ profesionalId: ADMIN, esAdministrador: true, adminId: ADMIN });
const deRafa = () => obtenerEconomia({ profesionalId: RAFA, adminId: ADMIN });
const deOtro = () => obtenerEconomia({ profesionalId: OTRO, adminId: ADMIN });

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
    // «cli-a» es del administrador; «cli-d», de Rafa (bono de 35 €/sesión).
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

  it("las cuotas de mensualidad son SOLO del administrador", async () => {
    // Un entrenador no puede llevar mensualidades, así que su economía nunca
    // tiene cuotas (regla de Fernando, 2026-08-11).
    expect((await deAdmin()).mesActual.facturacionCuotas).toBe(720);
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

// ---------------------------------------------------------------------------
// El histórico anterior a que existieran los profesionales
// ---------------------------------------------------------------------------

describe("lo de antes de que hubiera profesionales", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("es del administrador, aunque el cliente sea hoy de otro", async () => {
    // El caso que Fernando marcó como importante: un cliente que hoy lleva
    // Rafa pudo entrenar meses antes de que Rafa existiera en el sistema. Ese
    // pasado no es suyo.
    const repo = repositorio();
    // Una sesión de julio, anterior al corte, de un cliente que HOY es de Rafa.
    await repo.asignarProfesional("cli-a", RAFA);

    const admin = await deAdmin();
    const rafa = await deRafa();

    const julioAdmin = admin.anteriores.find((m) => m.mes === 7);
    expect(julioAdmin?.facturacionTotal).toBeGreaterThan(0);
    // Y a Rafa no le aparece ese julio.
    expect(rafa.anteriores.some((m) => m.mes === 7)).toBe(false);
  });

  it("la frontera está en el día en que se crearon los profesionales", async () => {
    expect(DESDE_QUE_HAY_PROFESIONALES).toBe("2026-08-09");

    // Una sesión del día ANTERIOR es del administrador…
    expect(
      duenioDeLaSesion({ fecha: "2026-08-08", responsableActual: RAFA, adminId: ADMIN }),
    ).toBe(ADMIN);
    // …y una del mismo día ya se atribuye al responsable del cliente.
    expect(
      duenioDeLaSesion({ fecha: "2026-08-09", responsableActual: RAFA, adminId: ADMIN }),
    ).toBe(RAFA);
  });

  it("lo que guardó su profesional manda por encima de todo", async () => {
    // Aunque sea antigua y aunque el cliente cambie de manos.
    expect(
      duenioDeLaSesion({
        profesionalId: RAFA,
        fecha: "2020-01-01",
        responsableActual: ADMIN,
        adminId: ADMIN,
      }),
    ).toBe(RAFA);
  });
});

// ---------------------------------------------------------------------------
// Un entrenador solo lleva bonos
// ---------------------------------------------------------------------------

describe("qué modalidades puede llevar cada uno", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  const alta = (modalidad: string, profesionalId: string) =>
    crearCliente({
      nombre: `Prueba ${modalidad} ${profesionalId}`,
      modalidad: modalidad as never,
      servicio: "Prueba",
      sesionesTotales: modalidad === "bono" ? 8 : null,
      precioTotal: modalidad === "bono" ? 360 : null,
      cuotaMensual: modalidad === "mensualidad" ? 720 : null,
      tarifa: modalidad === "cuenta" ? 35 : modalidad === "bono" ? 45 : null,
      profesionalId,
    });

  it("un entrenador SÍ puede llevar un bono", async () => {
    await expect(alta("bono", RAFA)).resolves.toBeDefined();
  });

  it("pero NO una mensualidad", async () => {
    await expect(alta("mensualidad", RAFA)).rejects.toThrow(/solo puede llevar clientes con bono/i);
  });

  it("ni una cuenta de cliente", async () => {
    await expect(alta("cuenta", RAFA)).rejects.toThrow(/solo puede llevar clientes con bono/i);
  });

  it("el administrador puede llevar las tres", async () => {
    for (const modalidad of ["bono", "mensualidad", "cuenta"]) {
      await expect(alta(modalidad, ADMIN), modalidad).resolves.toBeDefined();
    }
  });

  it("tampoco se le puede convertir su bono en mensualidad después", async () => {
    // El mismo agujero por otra puerta: cambiar el programa de un cliente suyo.
    await expect(
      configurarServicio("cli-d", { modalidad: "mensualidad" as never, servicio: "M", cuotaMensual: 720 }),
    ).rejects.toThrow(/solo puede llevar clientes con bono/i);
  });

  it("ni traspasarle un cliente con mensualidad", async () => {
    // «cli-b» es una mensualidad del administrador.
    await expect(traspasarCliente("cli-b", RAFA)).rejects.toThrow(/solo puede llevar clientes con bono/i);
  });

  it("y traspasarle un bono sí vale", async () => {
    await expect(traspasarCliente("cli-a", RAFA)).resolves.toBeUndefined();
  });

  it("la regla se decide por el rol, no por el nombre", async () => {
    expect(puedeLlevarModalidad(true, "mensualidad" as never)).toBe(true);
    expect(puedeLlevarModalidad(false, "mensualidad" as never)).toBe(false);
    expect(puedeLlevarModalidad(false, "bono" as never)).toBe(true);
  });
});
