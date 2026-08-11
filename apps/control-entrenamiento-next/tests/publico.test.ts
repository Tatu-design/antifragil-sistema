/**
 * El enlace personal del cliente.
 *
 * Es el único sitio donde alguien entra sin cuenta, así que aquí se comprueba
 * sobre todo lo que **no** puede pasar: que un token destape a otro cliente,
 * que confirmar cree una sesión, o que escanear dos veces cuente doble.
 */

import { readFileSync } from "node:fs";

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
    expect(perfil!.programas.length).toBeGreaterThan(0);
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

  it("en su historial solo hay sesiones suyas", async () => {
    const perfil = await obtenerPerfilPublico(TOKEN_A);
    const suyas = await repositorio().listarSesiones("cli-a");
    const enPantalla = perfil!.programas.flatMap((p) => p.sesiones);

    expect(enPantalla).toHaveLength(suyas.length);
    const idsSuyos = new Set(suyas.map((s) => s.id));
    for (const sesion of enPantalla) expect(idsSuyos.has(sesion.id)).toBe(true);
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

// ---------------------------------------------------------------------------
// Lo que ve el cliente en su pantalla (2026-08-10)
// ---------------------------------------------------------------------------

describe("la pantalla del cliente", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("le dice quién le entrena: nombre y foto, nada más", async () => {
    const perfil = await obtenerPerfilPublico(TOKEN_A);

    expect(perfil!.profesional).not.toBeNull();
    expect(perfil!.profesional!.nombre).toBe("Administrador");
    // NI el correo NI el rol: esta pantalla la abre cualquiera con el enlace.
    expect(Object.keys(perfil!.profesional!).sort()).toEqual(["foto", "nombre"]);
  });

  it("un cliente sin profesional asignado no rompe la pantalla", async () => {
    const repo = repositorio();
    await repo.asignarProfesional("cli-a", null);

    const perfil = await obtenerPerfilPublico(TOKEN_A);
    expect(perfil!.profesional).toBeNull();
  });

  it("la tarifa NI SIQUIERA SE LE MANDA", async () => {
    // Era el fallo de fondo, y dejar de pintarlo no bastaba: Next incrusta en
    // la página los datos que recibe el navegador, así que la tarifa se veía
    // mirando el código fuente aunque no saliera en pantalla.
    //
    // Se comprueba sobre el DATO que sale del servicio, no sobre el código de
    // la pantalla: es lo único que demuestra que no viaja.
    const perfil = await obtenerPerfilPublico(TOKEN_A);

    for (const sesion of perfil!.programas.flatMap((p) => p.sesiones)) {
      expect(Object.keys(sesion).sort()).toEqual(["fecha", "hora", "id", "numeroSesion"]);
    }
    // Ni la tarifa ni el NOMBRE del programa, que la lleva dentro.
    const texto = JSON.stringify(perfil!.programas);
    expect(texto).not.toContain("tarifa");
    expect(texto).not.toContain("servicio");
  });

  it("y en el historial solo van la fecha y la hora", async () => {
    const pagina = readFileSync("src/components/HistorialPublico.tsx", "utf8");
    expect(pagina).toContain("fechaEs(sesion.fecha)");
    expect(pagina).toContain("sesion.hora");
    expect(pagina).not.toContain("sesionesTotales");
  });

  it("el historial va agrupado por programa, el actual primero", async () => {
    const repo = repositorio();
    // Se cierra el bono en curso y se abre otro: dos programas.
    const ciclo = (await repo.listarCiclos("cli-a")).find((c) => c.ciclo === 1)!;
    await repo.guardarCiclo({ ...ciclo, fechaFin: "2026-07-29" });
    await repo.guardarCiclo({ ...ciclo, ciclo: 2, fechaInicio: "2026-08-01", fechaFin: null });
    const cliente = (await repo.obtenerCliente("cli-a"))!;
    await repo.actualizarCliente({ ...cliente, cicloActual: 2 });

    const { programas } = (await obtenerPerfilPublico(TOKEN_A))!;

    expect(programas.length).toBeGreaterThan(1);
    expect(programas[0]!.esActual).toBe(true);
    expect(programas.filter((p) => p.esActual)).toHaveLength(1);
    // Y cada programa trae sus fechas, que es como se identifica sin nombre.
    const anterior = programas.find((p) => !p.esActual)!;
    expect(anterior.hasta).toBe("2026-07-29");
    expect(anterior.sesiones.length).toBeGreaterThan(0);
  });

  it("dentro de cada programa, la sesión más reciente arriba", async () => {
    const { programas } = (await obtenerPerfilPublico(TOKEN_A))!;
    for (const programa of programas) {
      const fechas = programa.sesiones.map((s) => s.fecha);
      expect([...fechas].sort((a, b) => b.localeCompare(a))).toEqual(fechas);
    }
  });

  it("NO se le enseña el nombre del programa: lleva su tarifa dentro", async () => {
    // «Nuevo 45€ x4», «Pareja 60€ x16», «Antiguo 35€ x8»… son etiquetas
    // internas. Se lo estaban viendo 7 de 9 clientes (2026-08-10).
    const pagina = readFileSync("src/app/mi/[token]/page.tsx", "utf8");
    expect(pagina).not.toContain("ficha.servicio");

    const perfil = await obtenerPerfilPublico(TOKEN_A);
    expect(JSON.stringify(perfil!.programas)).not.toContain("Bono 8 sesiones");
  });

  it("cada programa se despliega por separado", async () => {
    // Abrir el historial y encontrarse todas las sesiones de todos los
    // programas de golpe era el mismo problema que tenía la pantalla antes,
    // solo que un toque más adentro (Fernando, 2026-08-10).
    const pagina = readFileSync("src/components/HistorialPublico.tsx", "utf8");
    expect(pagina).toContain("desplegados");
    expect(pagina).toContain("aria-expanded={desplegado}");
    // Y arrancan todos plegados, como el historial de la ficha interna.
    expect(pagina).toContain("useState<number[]>([])");
  });

  it("el historial nace plegado", async () => {
    // Con dieciseis sesiones, la lista entera empujaba hacia abajo lo que el
    // cliente abre a mirar: cuántas lleva y cuántas le quedan.
    const pagina = readFileSync("src/components/HistorialPublico.tsx", "utf8");
    expect(pagina).toContain("useState(false)");
  });

  it("no se le enseñan las sesiones previstas del mes", async () => {
    // Es una referencia interna para calcular, no un compromiso. Enseñársela
    // lo convierte en uno --«me habías dicho doce»-- cuando en una
    // mensualidad se entrena lo que se pueda ese mes (Fernando, 2026-08-11).
    const pagina = readFileSync("src/app/mi/[token]/page.tsx", "utf8");
    expect(pagina).not.toContain("sesionesReferencia");
    expect(pagina).not.toContain("Previstas");
  });

  it("no se le habla de «bono», sino de su programa", async () => {
    const pagina = readFileSync("src/app/mi/[token]/page.tsx", "utf8");
    expect(pagina).not.toContain("Así va tu bono");
    expect(pagina).toContain("Así va tu programa");
  });

  it("y sigue sin colársele nada del negocio", async () => {
    const perfil = await obtenerPerfilPublico(TOKEN_A);
    const texto = JSON.stringify(perfil).toLowerCase();
    for (const prohibido of ["ltv", "correo", "email", "entrenador_id", "rol"]) {
      expect(texto, prohibido).not.toContain(prohibido);
    }
  });
});
