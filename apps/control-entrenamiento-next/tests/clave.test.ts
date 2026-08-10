/**
 * Cambiar la propia contraseña.
 *
 * Nace de un descuido: le di a Rafa una contraseña temporal y le dije que la
 * cambiara al entrar, cuando **no existía ninguna pantalla para hacerlo**. Una
 * contraseña temporal que no se puede cambiar no es temporal.
 *
 * Lo que se comprueba aquí es sobre todo lo que NO puede pasar.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { esquemaClave } from "@/schemas/formularios";

const valido = { actual: "la-de-antes", nueva: "unaNuevaLarga", repetir: "unaNuevaLarga" };
const error = (datos: Record<string, string>) =>
  esquemaClave.safeParse(datos).error?.issues[0]?.message ?? "";

describe("las reglas de la contraseña nueva", () => {
  it("con los tres campos bien, pasa", () => {
    expect(esquemaClave.safeParse(valido).success).toBe(true);
  });

  it("tiene que tener al menos 8 caracteres", () => {
    expect(error({ ...valido, nueva: "corta1", repetir: "corta1" })).toContain("8 caracteres");
  });

  it("las dos nuevas tienen que coincidir", () => {
    expect(error({ ...valido, repetir: "otraDistinta" })).toContain("no coinciden");
  });

  it("no vale poner la misma que ya tenías", () => {
    // Si no, «cambiar la contraseña» podría no cambiar nada y quedarse uno
    // tranquilo pensando que sí.
    expect(error({ actual: "iguales123", nueva: "iguales123", repetir: "iguales123" })).toContain(
      "distinta",
    );
  });

  it("hay que escribir la actual", () => {
    expect(error({ ...valido, actual: "" })).toContain("actual");
  });
});

describe("de quién es la contraseña que se cambia", () => {
  const ACCION = readFileSync(path.join(process.cwd(), "src", "app", "actions.ts"), "utf8");
  const bloque = (() => {
    const i = ACCION.indexOf("export async function accionCambiarClave");
    return ACCION.slice(i, ACCION.indexOf("\n}\n", i));
  })();

  it("el correo sale de la SESIÓN, nunca del formulario", () => {
    // Es la línea que impide que alguien cambie la contraseña de otro
    // escribiendo su correo en el formulario.
    expect(bloque).toContain("quien.correo");
    expect(bloque).not.toMatch(/validado\.data\.correo/);
  });

  it("se comprueba la contraseña actual antes de cambiar nada", () => {
    // Una sesión olvidada en un móvil no debe bastar para quedarse con la
    // cuenta: hay que saber la contraseña.
    const iComprueba = bloque.indexOf("verificarCredenciales");
    const iCambia = bloque.indexOf("cambiarClave(");
    expect(iComprueba).toBeGreaterThan(-1);
    expect(iCambia).toBeGreaterThan(iComprueba);
  });

  it("y exige haber iniciado sesión", () => {
    expect(bloque).toContain("exigirUsuario()");
  });

  it("el panel lo tienen los dos roles, no solo el administrador", () => {
    // Rafa es justamente quien más lo necesita: entra con una contraseña
    // temporal y tiene que poder estrenarla.
    const panel = readFileSync(
      path.join(process.cwd(), "src", "components", "PanelPerfil.tsx"),
      "utf8",
    );
    expect(panel).not.toContain("esAdmin");
    // Y se llega desde la cabecera de las tres pantallas con barra.
    for (const pantalla of ["clientes", "avisos", "economia"]) {
      const pagina = readFileSync(
        path.join(process.cwd(), "src", "app", pantalla, "page.tsx"),
        "utf8",
      );
      expect(pagina, pantalla).toContain("BotonPerfil");
    }
  });

  it("el perfil que se edita sale de la sesión, no del formulario", () => {
    const bloquePerfil = (() => {
      const i = ACCION.indexOf("export async function accionGuardarPerfil");
      return ACCION.slice(i, ACCION.indexOf("\n}\n", i));
    })();
    expect(bloquePerfil).toContain("quien.id");
    expect(bloquePerfil).not.toMatch(/validado\.data\.(id|perfilId)/);
  });

  it("la contraseña no se cifra en JavaScript: la cifra la base de datos", () => {
    const repo = readFileSync(
      path.join(process.cwd(), "src", "repositories", "usuarios.ts"),
      "utf8",
    );
    expect(repo).toContain("crypt($2, gen_salt('bf'))");
  });
});
