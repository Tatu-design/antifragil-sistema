/**
 * El recorrido completo de firmar, contra el repositorio de staging real.
 *
 * Comprueba lo que de verdad importa: que se descuenta una sesión, que la
 * última renueva, que el ciclo nuevo nace pendiente, que una petición repetida
 * no se guarda dos veces, y que borrar deshace exactamente lo que hizo firmar.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { BONO, CUENTA, MENSUALIDAD } from "@/domain/modalidades";
import { hoyNegocio } from "@/lib/fechas";
import { repositorio } from "@/repositories";
import { reiniciarStagingParaPruebas } from "@/repositories/staging";
import { cambiarEstado, marcarCobro, obtenerPerfil } from "@/services/clientes";
import { eliminarSesion, firmarSesion } from "@/services/sesiones";

const BONO_CASI_AGOTADO = "cli-a"; // 6 de 8 sesiones, tarifa 45 €
const MENSUAL = "cli-b"; // cuota 720 €
const CUENTA_CLIENTE = "cli-f"; // 35 €/sesión, sin tope. Del admin: un entrenador solo lleva bonos.
const PAUSADO = "cli-e";

describe("firmar una sesión", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("descuenta exactamente una sesión del bono", async () => {
    const antes = await obtenerPerfil(BONO_CASI_AGOTADO);
    const resultado = await firmarSesion(BONO_CASI_AGOTADO, { fecha: "2026-08-03" });
    const despues = await obtenerPerfil(BONO_CASI_AGOTADO);

    expect(resultado.numeroSesion).toBe(7);
    expect(resultado.renovado).toBe(false);
    expect(despues!.ficha.sesionesHechas).toBe(antes!.ficha.sesionesHechas + 1);
    expect(despues!.ficha.sesionesRestantes).toBe(1);
  });

  it("avisa de que queda una sola sesión", async () => {
    const resultado = await firmarSesion(BONO_CASI_AGOTADO, { fecha: "2026-08-03" });
    expect(resultado.avisoUltimaSesion).toBe(true);
  });

  it("la última sesión renueva y el ciclo nuevo nace pendiente de pago", async () => {
    await firmarSesion(BONO_CASI_AGOTADO, { fecha: "2026-08-03" }); // 7
    const resultado = await firmarSesion(BONO_CASI_AGOTADO, { fecha: "2026-08-04" }); // 8

    expect(resultado.renovado).toBe(true);
    expect(resultado.numeroSesion).toBe(8);

    const perfil = await obtenerPerfil(BONO_CASI_AGOTADO);
    expect(perfil!.cliente.cicloActual).toBe(2);
    expect(perfil!.ficha.pendientePago).toBe(true);
    expect(perfil!.ficha.sesionesHechas).toBe(0);
  });

  it("la renovación conserva servicio, tarifa y número de sesiones", async () => {
    await firmarSesion(BONO_CASI_AGOTADO, { fecha: "2026-08-03" });
    await firmarSesion(BONO_CASI_AGOTADO, { fecha: "2026-08-04" });

    const perfil = await obtenerPerfil(BONO_CASI_AGOTADO);
    const nuevo = perfil!.servicios.find((s) => s.ciclo === 2)!;
    const anterior = perfil!.servicios.find((s) => s.ciclo === 1)!;

    expect(nuevo.modalidad).toBe(BONO);
    expect(nuevo.tarifa).toBe(anterior.tarifa);
    expect(nuevo.sesionesTotales).toBe(anterior.sesionesTotales);
    expect(nuevo.servicio).toBe(anterior.servicio);
    expect(nuevo.pagado).toBe(false);
    expect(anterior.fechaFin).toBe("2026-08-04");
  });

  it("la misma petición repetida no se guarda dos veces", async () => {
    const primera = await firmarSesion(BONO_CASI_AGOTADO, { fecha: "2026-08-03", claveIdempotencia: "k1" });
    const segunda = await firmarSesion(BONO_CASI_AGOTADO, { fecha: "2026-08-03", claveIdempotencia: "k1" });

    expect(primera.duplicado).toBe(false);
    expect(segunda.duplicado).toBe(true);

    const sesiones = await repositorio().listarSesiones(BONO_CASI_AGOTADO);
    expect(sesiones.filter((s) => s.fecha === "2026-08-03")).toHaveLength(1);
  });

  it("una segunda sesión real el mismo día sí se puede firmar", async () => {
    await firmarSesion(BONO_CASI_AGOTADO, { fecha: "2026-08-03", claveIdempotencia: "k1" });
    await firmarSesion(BONO_CASI_AGOTADO, { fecha: "2026-08-03", claveIdempotencia: "k2" });

    const sesiones = await repositorio().listarSesiones(BONO_CASI_AGOTADO);
    expect(sesiones.filter((s) => s.fecha === "2026-08-03")).toHaveLength(2);
  });

  it("suma su importe y su hora a la semana", async () => {
    await firmarSesion(BONO_CASI_AGOTADO, { fecha: "2026-08-03" });
    const semana = (await repositorio().listarSemanas()).find((s) => s.inicio === "2026-08-03")!;
    expect(semana.facturacion).toBe(45);
    expect(semana.horas).toBe(1);
  });

  it("una sesión de mensualidad suma HORA pero no dinero (H-01)", async () => {
    await firmarSesion(MENSUAL, { fecha: "2026-08-03" });
    const semana = (await repositorio().listarSemanas()).find((s) => s.inicio === "2026-08-03")!;
    expect(semana.facturacion).toBe(0);
    expect(semana.horasSinImporte).toBe(1);

    const sesiones = await repositorio().listarSesiones(MENSUAL);
    expect(sesiones[0]!.tarifa).toBeNull();
  });

  it("una cuenta de cliente no tiene tope: se firma sin renovar nunca", async () => {
    for (let i = 0; i < 15; i += 1) {
      await firmarSesion(CUENTA_CLIENTE, { fecha: "2026-08-03" });
    }
    const perfil = await obtenerPerfil(CUENTA_CLIENTE);
    expect(perfil!.cliente.cicloActual).toBe(1);
    expect(perfil!.ficha.sesionesHechas).toBe(15);
    expect(perfil!.ficha.facturacion).toBe(525); // 15 × 35
  });

  it("un cliente pausado no puede firmar, aunque se llame a la acción directamente", async () => {
    await expect(firmarSesion(PAUSADO, { fecha: "2026-08-03" })).rejects.toThrow(/pausado/i);
    const sesiones = await repositorio().listarSesiones(PAUSADO);
    expect(sesiones.filter((s) => s.fecha === "2026-08-03")).toHaveLength(0);
  });

  it("un intento bloqueado no toca ni el bono ni la economía", async () => {
    const antes = await obtenerPerfil(PAUSADO);
    const semanasAntes = await repositorio().listarSemanas();
    await expect(firmarSesion(PAUSADO, { fecha: "2026-08-03" })).rejects.toThrow();
    expect((await obtenerPerfil(PAUSADO))!.ficha.sesionesHechas).toBe(antes!.ficha.sesionesHechas);
    expect(await repositorio().listarSemanas()).toEqual(semanasAntes);
  });

  it("al reactivar a un cliente pausado se le puede volver a firmar", async () => {
    await cambiarEstado(PAUSADO, "activo");
    const resultado = await firmarSesion(PAUSADO, { fecha: "2026-08-03" });
    expect(resultado.numeroSesion).toBe(3);
  });
});

describe("borrar una sesión deshace lo que hizo firmar", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("devuelve la unidad al bono y descuenta su importe", async () => {
    await firmarSesion(BONO_CASI_AGOTADO, { fecha: "2026-08-03" });
    const semanaConSesion = (await repositorio().listarSemanas()).find((s) => s.inicio === "2026-08-03")!;
    expect(semanaConSesion.facturacion).toBe(45);

    const sesiones = await repositorio().listarSesiones(BONO_CASI_AGOTADO);
    await eliminarSesion(BONO_CASI_AGOTADO, sesiones[0]!.id);

    const perfil = await obtenerPerfil(BONO_CASI_AGOTADO);
    expect(perfil!.ficha.sesionesHechas).toBe(6);
    const semana = (await repositorio().listarSemanas()).find((s) => s.inicio === "2026-08-03")!;
    expect(semana.facturacion).toBe(0);
    expect(semana.horas).toBe(0);
  });

  it("borrar la sesión que renovó deshace también la renovación", async () => {
    await firmarSesion(BONO_CASI_AGOTADO, { fecha: "2026-08-03" });
    await firmarSesion(BONO_CASI_AGOTADO, { fecha: "2026-08-04" });
    expect((await obtenerPerfil(BONO_CASI_AGOTADO))!.cliente.cicloActual).toBe(2);

    const sesiones = await repositorio().listarSesiones(BONO_CASI_AGOTADO);
    await eliminarSesion(BONO_CASI_AGOTADO, sesiones[0]!.id);

    const perfil = await obtenerPerfil(BONO_CASI_AGOTADO);
    expect(perfil!.cliente.cicloActual).toBe(1);
    expect(perfil!.ficha.pendientePago).toBe(false);
    expect(perfil!.ficha.sesionesHechas).toBe(7);
  });

  it("usa la tarifa histórica de la sesión, no la actual del cliente", async () => {
    await firmarSesion(CUENTA_CLIENTE, { fecha: "2026-08-03" });
    const sesion = (await repositorio().listarSesiones(CUENTA_CLIENTE))[0]!;
    expect(sesion.tarifa).toBe(35);

    // Cambia el precio del servicio DESPUÉS de firmar.
    const ciclo = await repositorio().cicloActual(CUENTA_CLIENTE);
    await repositorio().guardarCiclo({ ...ciclo!, tarifa: 60 });

    await eliminarSesion(CUENTA_CLIENTE, sesion.id);
    const semana = (await repositorio().listarSemanas()).find((s) => s.inicio === "2026-08-03")!;
    // Se descuentan los 35 € que sumó, no los 60 € de ahora.
    expect(semana.facturacion).toBe(0);
  });
});

describe("el cobro no mueve dinero", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("marcar cobrado no cambia facturación ni sesiones", async () => {
    await firmarSesion(BONO_CASI_AGOTADO, { fecha: "2026-08-03" });
    const antes = await obtenerPerfil(BONO_CASI_AGOTADO);
    const semanasAntes = await repositorio().listarSemanas();

    await marcarCobro(BONO_CASI_AGOTADO, 1, false);
    await marcarCobro(BONO_CASI_AGOTADO, 1, true);

    const despues = await obtenerPerfil(BONO_CASI_AGOTADO);
    expect(despues!.ficha.sesionesHechas).toBe(antes!.ficha.sesionesHechas);
    expect(despues!.ficha.facturacion).toBe(antes!.ficha.facturacion);
    expect(await repositorio().listarSemanas()).toEqual(semanasAntes);
  });

  it("en una mensualidad, ciclo y cargo del mes dicen lo mismo (H-02)", async () => {
    const perfil = await obtenerPerfil(MENSUAL);
    expect(perfil!.ficha.pendientePago).toBe(true);

    await marcarCobro(MENSUAL, 1, true);

    const despues = await obtenerPerfil(MENSUAL);
    // El mes en curso, no uno escrito a mano: el 1 de septiembre esta prueba
    // se puso roja sola porque preguntaba por agosto (2026-09-02).
    const hoy = hoyNegocio();
    const cargo = await repositorio().cargoDelMes(MENSUAL, Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)));
    expect(despues!.ficha.pendientePago).toBe(false);
    expect(cargo!.pagado).toBe(true);
    expect(despues!.servicios[0]!.pagado).toBe(true);
  });

  it("una mensualidad recién creada está pendiente, no pagada", async () => {
    const ciclo = await repositorio().cicloActual(MENSUAL);
    expect(ciclo!.modalidad).toBe(MENSUALIDAD);
    expect(ciclo!.pagado).toBe(false);
  });
});

describe("la modalidad decide, no la pantalla", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("las tres modalidades dejan firmar", async () => {
    for (const id of [BONO_CASI_AGOTADO, MENSUAL, CUENTA_CLIENTE]) {
      const perfil = await obtenerPerfil(id);
      expect(perfil!.ficha.puedeFirmar).toBe(true);
    }
    expect((await obtenerPerfil(CUENTA_CLIENTE))!.ficha.modalidad).toBe(CUENTA);
  });
});
