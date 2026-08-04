/**
 * El acceso.
 *
 * Se comprueba sobre todo lo que **no** puede pasar: entrar sin cuenta,
 * falsificar la cookie, alargarla, o que la puerta de emergencia funcione
 * cuando está apagada.
 */

import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import path from "node:path";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const env = Object.fromEntries(
  (() => {
    try {
      return readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]);
    } catch {
      return [];
    }
  })(),
);
if (env.DATABASE_URL && !process.env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;
process.env.SESSION_SECRET ??= "secreto-de-pruebas";

/** Una cookie de mentira, en memoria, para no depender de Next. */
const almacen = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nombre: string) => (almacen.has(nombre) ? { value: almacen.get(nombre) } : undefined),
    set: (nombre: string, valor: string) => almacen.set(nombre, valor),
    delete: (nombre: string) => almacen.delete(nombre),
    getAll: () => [...almacen].map(([name, value]) => ({ name, value })),
  }),
}));

const hayBase = Boolean(process.env.DATABASE_URL);

let auth: typeof import("@/lib/auth");

beforeAll(async () => {
  auth = await import("@/lib/auth");
});

afterEach(() => {
  almacen.clear();
  delete process.env.PERMITIR_CLAVE_UNICA;
});

function firmar(contenido: string): string {
  return `${contenido}.${createHmac("sha256", process.env.SESSION_SECRET!).update(contenido).digest("hex")}`;
}

describe("la sesión", () => {
  it("sin cookie, no hay sesión", async () => {
    expect(await auth.haySesion()).toBe(false);
    expect(await auth.correoActual()).toBeNull();
  });

  it("una cookie inventada no vale", async () => {
    almacen.set("af_sesion", "fernando.firmafalsa");
    expect(await auth.haySesion()).toBe(false);
  });

  it("una cookie con el contenido cambiado no vale", async () => {
    // Se firma un contenido y luego se altera: la firma deja de cuadrar.
    const bueno = Buffer.from(JSON.stringify({ correo: "a@b.c", caduca: Date.now() + 10000 })).toString("base64url");
    const cookie = firmar(bueno);
    const malo = Buffer.from(JSON.stringify({ correo: "otro@b.c", caduca: Date.now() + 10000 })).toString("base64url");
    almacen.set("af_sesion", cookie.replace(bueno, malo));
    expect(await auth.haySesion()).toBe(false);
  });

  it("una sesión caducada no vale, aunque la firma sea buena", async () => {
    // La caducidad va DENTRO de lo firmado: alargarla exige falsificar.
    const contenido = Buffer.from(
      JSON.stringify({ correo: "a@b.c", caduca: Date.now() - 1000 }),
    ).toString("base64url");
    almacen.set("af_sesion", firmar(contenido));
    expect(await auth.haySesion()).toBe(false);
  });

  it("una sesión válida sí vale y dice quién es", async () => {
    const contenido = Buffer.from(
      JSON.stringify({ correo: "fer@antifragil.es", caduca: Date.now() + 60000 }),
    ).toString("base64url");
    almacen.set("af_sesion", firmar(contenido));
    expect(await auth.haySesion()).toBe(true);
    expect(await auth.correoActual()).toBe("fer@antifragil.es");
  });

  it("salir la borra", async () => {
    const contenido = Buffer.from(
      JSON.stringify({ correo: "a@b.c", caduca: Date.now() + 60000 }),
    ).toString("base64url");
    almacen.set("af_sesion", firmar(contenido));
    await auth.cerrarSesion();
    expect(await auth.haySesion()).toBe(false);
  });
});

describe("la puerta de emergencia", () => {
  it("está apagada por defecto", async () => {
    expect(auth.claveUnicaDisponible()).toBe(false);
    const r = await auth.entrarConClaveUnica("loquesea");
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/desactivada/i);
  });

  it("encendida, deja entrar con la contraseña correcta", async () => {
    process.env.PERMITIR_CLAVE_UNICA = "1";
    process.env.APP_PASSWORD = "clave-de-pruebas";
    expect((await auth.entrarConClaveUnica("clave-de-pruebas")).ok).toBe(true);
    expect(await auth.haySesion()).toBe(true);
  });

  it("encendida, rechaza la incorrecta", async () => {
    process.env.PERMITIR_CLAVE_UNICA = "1";
    process.env.APP_PASSWORD = "clave-de-pruebas";
    expect((await auth.entrarConClaveUnica("otra")).ok).toBe(false);
  });

  it("apagarla echa a quien había entrado por ahí", async () => {
    process.env.PERMITIR_CLAVE_UNICA = "1";
    process.env.APP_PASSWORD = "clave-de-pruebas";
    await auth.entrarConClaveUnica("clave-de-pruebas");
    expect(await auth.haySesion()).toBe(true);

    delete process.env.PERMITIR_CLAVE_UNICA;
    expect(await auth.haySesion()).toBe(false);
  });
});

(hayBase ? describe : describe.skip)("entrar con una cuenta de verdad", () => {
  it("una contraseña incorrecta no entra", async () => {
    const r = await auth.entrar("fcmarcos12@gmail.com", "no-es-esta");
    expect(r.ok).toBe(false);
    expect(await auth.haySesion()).toBe(false);
  });

  it("un correo que no existe da el MISMO mensaje", async () => {
    // No se distingue: decirlo permitiría averiguar qué correos hay dados de
    // alta probando uno a uno.
    const a = await auth.entrar("fcmarcos12@gmail.com", "no-es-esta");
    const b = await auth.entrar("nadie@ejemplo.com", "loquesea");
    expect(b.mensaje).toBe(a.mensaje);
  });

  it("con la contraseña correcta entra y queda identificado", async () => {
    const clave = process.env.CLAVE_PRUEBA;
    if (!clave) return; // solo cuando se pasa a propósito
    const r = await auth.entrar("fcmarcos12@gmail.com", clave);
    expect(r.ok).toBe(true);
    expect(await auth.correoActual()).toBe("fcmarcos12@gmail.com");
  });
});
