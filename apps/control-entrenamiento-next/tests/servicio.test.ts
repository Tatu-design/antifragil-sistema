/**
 * Configurar el servicio de un cliente.
 *
 * La regla delicada: cambiar de modalidad **cierra** el servicio en curso y
 * abre otro. Nunca transforma un ciclo empezado, porque eso reescribiría la
 * economía de sesiones ya hechas.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { BONO, CUENTA, ErrorDeNegocio, MENSUALIDAD } from "@/domain/modalidades";
import { repositorio } from "@/repositories";
import { reiniciarStagingParaPruebas } from "@/repositories/staging";
import { cambiarEstado, configurarServicio, obtenerPerfil } from "@/services/clientes";
import { firmarSesion } from "@/services/sesiones";

const BONO_CLIENTE = "cli-a"; // bono 8 × 45 €, 6 hechas
const MENSUAL = "cli-b"; // cuota 720 €
const CUENTA_CLIENTE = "cli-f"; // 35 €/sesión, del admin

describe("corregir las condiciones sin cambiar de modalidad", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("no abre un ciclo nuevo", async () => {
    const resultado = await configurarServicio(BONO_CLIENTE, {
      modalidad: BONO,
      servicio: "Bono 10 sesiones",
      sesionesTotales: 10,
      precioTotal: 600,
    });
    expect(resultado.cerroCiclo).toBe(false);

    const perfil = await obtenerPerfil(BONO_CLIENTE);
    expect(perfil!.servicios).toHaveLength(1);
    expect(perfil!.cliente.cicloActual).toBe(1);
  });

  it("aplica las condiciones nuevas al servicio en curso", async () => {
    await configurarServicio(BONO_CLIENTE, {
      modalidad: BONO,
      servicio: "Bono 10 sesiones",
      sesionesTotales: 10,
      precioTotal: 600,
    });
    const perfil = await obtenerPerfil(BONO_CLIENTE);
    expect(perfil!.ficha.sesionesTotales).toBe(10);
    expect(perfil!.ficha.tarifa).toBe(60);
    expect(perfil!.ficha.sesionesRestantes).toBe(4); // 10 − 6 hechas
  });

  it("las sesiones ya firmadas conservan su precio de entonces", async () => {
    const antes = await repositorio().listarSesiones(BONO_CLIENTE);
    expect(antes.every((s) => s.tarifa === 45)).toBe(true);

    await configurarServicio(BONO_CLIENTE, {
      modalidad: BONO,
      servicio: "Bono 8 sesiones",
      sesionesTotales: 8,
      precioTotal: 800, // 100 € por sesión a partir de ahora
    });

    const despues = await repositorio().listarSesiones(BONO_CLIENTE);
    expect(despues.every((s) => s.tarifa === 45)).toBe(true);
  });

  it("no recalcula la economía ya cerrada", async () => {
    const semanasAntes = await repositorio().listarSemanas();
    await configurarServicio(BONO_CLIENTE, {
      modalidad: BONO,
      servicio: "Bono 8 sesiones",
      sesionesTotales: 8,
      precioTotal: 800,
    });
    expect(await repositorio().listarSemanas()).toEqual(semanasAntes);
  });

  it("rechaza condiciones imposibles", async () => {
    await expect(
      configurarServicio(BONO_CLIENTE, {
        modalidad: BONO,
        servicio: "Bono raro",
        sesionesTotales: 8,
        precioTotal: 360,
        cuotaMensual: 720,
      }),
    ).rejects.toThrow(ErrorDeNegocio);
  });
});

describe("cambiar de modalidad cierra el servicio y abre otro", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("de bono a mensualidad: el bono queda cerrado con sus sesiones", async () => {
    const resultado = await configurarServicio(BONO_CLIENTE, {
      modalidad: MENSUALIDAD,
      servicio: "Mensualidad",
      cuotaMensual: 600,
    });
    expect(resultado.cerroCiclo).toBe(true);

    const perfil = await obtenerPerfil(BONO_CLIENTE);
    const bono = perfil!.servicios.find((s) => s.ciclo === 1)!;
    const nuevo = perfil!.servicios.find((s) => s.ciclo === 2)!;

    expect(bono.modalidad).toBe(BONO);
    expect(bono.fechaFin).not.toBeNull();
    expect(bono.sesiones).toHaveLength(6);
    expect(nuevo.modalidad).toBe(MENSUALIDAD);
    expect(nuevo.cuotaMensual).toBe(600);
    expect(nuevo.sesiones).toHaveLength(0);
  });

  it("las sesiones anteriores no se mueven ni se renumeran", async () => {
    const antes = await repositorio().listarSesiones(BONO_CLIENTE);
    await configurarServicio(BONO_CLIENTE, {
      modalidad: MENSUALIDAD,
      servicio: "Mensualidad",
      cuotaMensual: 600,
    });
    const despues = await repositorio().listarSesiones(BONO_CLIENTE);
    expect(despues).toEqual(antes);
  });

  it("el contador vuelve a cero, pero el historial no", async () => {
    await configurarServicio(BONO_CLIENTE, {
      modalidad: MENSUALIDAD,
      servicio: "Mensualidad",
      cuotaMensual: 600,
    });
    const perfil = await obtenerPerfil(BONO_CLIENTE);
    expect(perfil!.cliente.sesionesCompletadas).toBe(0);
    expect(perfil!.servicios.flatMap((s) => s.sesiones)).toHaveLength(6);
  });

  it("la mensualidad nueva nace pendiente y con su cuota del mes", async () => {
    await configurarServicio(BONO_CLIENTE, {
      modalidad: MENSUALIDAD,
      servicio: "Mensualidad",
      cuotaMensual: 600,
    });
    const perfil = await obtenerPerfil(BONO_CLIENTE);
    expect(perfil!.ficha.pendientePago).toBe(true);

    const hoy = new Date();
    const cargo = await repositorio().cargoDelMes(BONO_CLIENTE, hoy.getFullYear(), hoy.getMonth() + 1);
    expect(cargo!.importe).toBe(600);
    expect(cargo!.pagado).toBe(false);
  });

  it("no recalcula la economía del servicio anterior", async () => {
    const semanasAntes = await repositorio().listarSemanas();
    await configurarServicio(BONO_CLIENTE, {
      modalidad: MENSUALIDAD,
      servicio: "Mensualidad",
      cuotaMensual: 600,
    });
    expect(await repositorio().listarSemanas()).toEqual(semanasAntes);
  });

  it("de mensualidad a cuenta: se puede seguir firmando en el servicio nuevo", async () => {
    await configurarServicio(MENSUAL, { modalidad: CUENTA, servicio: "Cuenta", tarifa: 40 });
    const resultado = await firmarSesion(MENSUAL, { fecha: "2026-08-03" });
    expect(resultado.numeroSesion).toBe(1);

    const perfil = await obtenerPerfil(MENSUAL);
    expect(perfil!.ficha.modalidad).toBe(CUENTA);
    expect(perfil!.ficha.facturacion).toBe(40);
  });

  it("de cuenta a bono: el bono empieza entero, no a medias", async () => {
    await firmarSesion(CUENTA_CLIENTE, { fecha: "2026-08-03" });
    await firmarSesion(CUENTA_CLIENTE, { fecha: "2026-08-04" });

    await configurarServicio(CUENTA_CLIENTE, {
      modalidad: BONO,
      servicio: "Bono 5",
      sesionesTotales: 5,
      precioTotal: 250,
    });

    const perfil = await obtenerPerfil(CUENTA_CLIENTE);
    expect(perfil!.ficha.sesionesHechas).toBe(0);
    expect(perfil!.ficha.sesionesRestantes).toBe(5);
    expect(perfil!.ficha.tarifa).toBe(50);
  });

  it("un cliente pausado no genera cuota al pasarlo a mensualidad", async () => {
    await cambiarEstado(BONO_CLIENTE, "pausado");
    await configurarServicio(BONO_CLIENTE, {
      modalidad: MENSUALIDAD,
      servicio: "Mensualidad",
      cuotaMensual: 600,
    });
    const hoy = new Date();
    const cargo = await repositorio().cargoDelMes(BONO_CLIENTE, hoy.getFullYear(), hoy.getMonth() + 1);
    expect(cargo).toBeNull();
  });

  it("rellenar lo que faltaba deja firmar", async () => {
    // Un servicio incompleto bloquea la firma; completarlo la desbloquea.
    const ciclo = await repositorio().cicloActual(CUENTA_CLIENTE);
    await repositorio().guardarCiclo({ ...ciclo!, tarifa: null });
    expect((await obtenerPerfil(CUENTA_CLIENTE))!.ficha.puedeFirmar).toBe(false);

    await configurarServicio(CUENTA_CLIENTE, { modalidad: CUENTA, servicio: "Cuenta", tarifa: 35 });
    expect((await obtenerPerfil(CUENTA_CLIENTE))!.ficha.puedeFirmar).toBe(true);
  });
});
