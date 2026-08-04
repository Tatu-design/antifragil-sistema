/**
 * El enlace personal del cliente.
 *
 * Es el único sitio donde alguien entra sin cuenta, así que aquí se comprueba
 * sobre todo lo que **no** puede pasar: que un token destape a otro cliente,
 * que confirmar cree una sesión, o que escanear dos veces cuente doble.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { repositorio } from "@/repositories";
import { reiniciarStagingParaPruebas } from "@/repositories/staging";
import { confirmarSesion, obtenerPerfilPublico } from "@/services/publico";
import { firmarSesion } from "@/services/sesiones";
import { hoyNegocio } from "@/lib/fechas";

const TOKEN_A = "tok-cliente-a";
const TOKEN_C = "tok-pareja-c";

describe("lo que ve el cliente", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("su enlace le enseña lo suyo", async () => {
    const perfil = await obtenerPerfilPublico(TOKEN_A);
    expect(perfil!.nombre).toBe("Cliente A");
    expect(perfil!.ficha.sesionesRestantes).toBe(2);
    expect(perfil!.ultimas.length).toBeGreaterThan(0);
  });

  it("un token no destapa a ningún otro cliente", async () => {
    const perfil = await obtenerPerfilPublico(TOKEN_A);
    const texto = JSON.stringify(perfil);
    expect(texto).toContain("Cliente A");
    expect(texto).not.toContain("Pareja C");
    expect(texto).not.toContain("Cliente B");
  });

  it("cada token enseña a su dueño y a nadie más", async () => {
    expect((await obtenerPerfilPublico(TOKEN_C))!.nombre).toBe("Pareja C");
  });

  it("un token inventado no enseña nada", async () => {
    expect(await obtenerPerfilPublico("token-que-no-existe")).toBeNull();
  });

  it("no se le enseña el estado de cobro de otros ni su deuda ajena", async () => {
    const perfil = await obtenerPerfilPublico(TOKEN_A);
    // Solo aparecen sus propias sesiones.
    for (const sesion of perfil!.ultimas) {
      expect(sesion.servicio).toBe("Bono 8 sesiones");
    }
  });
});

describe("confirmar la sesión de hoy", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("sin sesión firmada hoy, no hay nada que confirmar", async () => {
    const perfil = await obtenerPerfilPublico(TOKEN_A);
    expect(perfil!.pendientesHoy).toHaveLength(0);
  });

  it("tras firmar Fernando, aparece una pendiente", async () => {
    await firmarSesion("cli-a", { fecha: hoyNegocio() });
    const perfil = await obtenerPerfilPublico(TOKEN_A);
    expect(perfil!.pendientesHoy).toHaveLength(1);
  });

  it("confirmar deja constancia con su hora", async () => {
    await firmarSesion("cli-a", { fecha: hoyNegocio() });
    const r = await confirmarSesion(TOKEN_A);
    expect(r.ok).toBe(true);
    expect(r.yaEstaba).toBe(false);
    expect(r.hora).toMatch(/^\d{2}:\d{2}$/);

    const perfil = await obtenerPerfilPublico(TOKEN_A);
    expect(perfil!.confirmadasHoy).toHaveLength(1);
    expect(perfil!.pendientesHoy).toHaveLength(0);
  });

  it("confirmar NO toca el bono, ni el historial, ni la economía", async () => {
    await firmarSesion("cli-a", { fecha: hoyNegocio() });
    const antesCliente = await repositorio().obtenerCliente("cli-a");
    const antesSesiones = await repositorio().listarSesiones("cli-a");
    const antesSemanas = await repositorio().listarSemanas();

    await confirmarSesion(TOKEN_A);

    expect(await repositorio().obtenerCliente("cli-a")).toEqual(antesCliente);
    expect(await repositorio().listarSesiones("cli-a")).toEqual(antesSesiones);
    expect(await repositorio().listarSemanas()).toEqual(antesSemanas);
  });

  it("escanear el QR dos veces no duplica nada", async () => {
    await firmarSesion("cli-a", { fecha: hoyNegocio() });
    await confirmarSesion(TOKEN_A);
    const segunda = await confirmarSesion(TOKEN_A);

    expect(segunda.ok).toBe(true);
    expect(segunda.yaEstaba).toBe(true);
    expect((await obtenerPerfilPublico(TOKEN_A))!.confirmadasHoy).toHaveLength(1);
  });

  it("dos sesiones el mismo día se confirman una a una", async () => {
    const hoy = hoyNegocio();
    await firmarSesion("cli-a", { fecha: hoy, claveIdempotencia: "a" });
    await firmarSesion("cli-a", { fecha: hoy, claveIdempotencia: "b" });
    expect((await obtenerPerfilPublico(TOKEN_A))!.pendientesHoy).toHaveLength(2);

    await confirmarSesion(TOKEN_A);
    expect((await obtenerPerfilPublico(TOKEN_A))!.pendientesHoy).toHaveLength(1);

    await confirmarSesion(TOKEN_A);
    const perfil = await obtenerPerfilPublico(TOKEN_A);
    expect(perfil!.pendientesHoy).toHaveLength(0);
    expect(perfil!.confirmadasHoy).toHaveLength(2);
  });

  it("confirmar con un token inválido no hace nada", async () => {
    const r = await confirmarSesion("token-falso");
    expect(r.ok).toBe(false);
  });

  it("el cliente NUNCA crea una sesión: solo confirma las que ya existen", async () => {
    // Sin sesión de Fernando, confirmar no puede inventarse ninguna.
    const antes = await repositorio().listarSesiones("cli-a");
    await confirmarSesion(TOKEN_A);
    expect(await repositorio().listarSesiones("cli-a")).toEqual(antes);
  });
});
