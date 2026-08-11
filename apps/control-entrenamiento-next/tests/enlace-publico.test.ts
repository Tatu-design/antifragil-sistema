/**
 * El enlace personal del cliente.
 *
 * NACE DE UN FALLO REAL (2026-08-11). Una clienta abrió su enlace y le salió
 * una pantalla pidiendo correo y contraseña. No era la nuestra: era **el login
 * de Vercel**.
 *
 * La causa: el enlace se construía con el `host` de la petición, y en Vercel la
 * misma aplicación responde en varias direcciones a la vez —la pública y una
 * por cada despliegue—. Las de despliegue están detrás de Deployment
 * Protection. Si el profesional estaba navegando por una de ellas, el botón
 * «Copiar enlace del cliente» copiaba esa, y el cliente se topaba con Vercel.
 *
 * Estas pruebas fijan la regla: **el enlace de un cliente no depende de por
 * dónde ande el profesional.**
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { enlaceDelCliente, urlPublica } from "@/lib/enlace-publico";

const PUBLICA = "https://antifragil-sistema.vercel.app";
const DESPLIEGUE = "antifragil-sistema-f9q05cljg-tatu5.vercel.app";
const TOKEN = "y2OJPmBaJ_jWEt50w5AQM67M6x659upu";

const configurada = process.env.URL_PUBLICA;

afterEach(() => {
  vi.unstubAllEnvs();
  if (configurada === undefined) delete process.env.URL_PUBLICA;
  else process.env.URL_PUBLICA = configurada;
});

// `NODE_ENV` no se puede reasignar a mano; `vi.stubEnv` es la forma que
// entiende Vitest.
const enProduccion = () => vi.stubEnv("NODE_ENV", "production");

describe("de dónde sale la dirección del enlace", () => {
  it("en producción, SIEMPRE la pública, esté donde esté el profesional", () => {
    enProduccion();
    delete process.env.URL_PUBLICA;

    for (const host of [DESPLIEGUE, "antifragil-sistema-otro-tatu5.vercel.app", "localhost:3000"]) {
      expect(urlPublica(host), host).toBe(PUBLICA);
    }
  });

  it("y por tanto el enlace del cliente también", () => {
    enProduccion();
    delete process.env.URL_PUBLICA;

    // Este es EXACTAMENTE el caso que rompió: el profesional navegando por una
    // dirección de despliegue.
    expect(enlaceDelCliente(TOKEN, DESPLIEGUE)).toBe(`${PUBLICA}/mi/${TOKEN}`);
    expect(enlaceDelCliente(TOKEN, DESPLIEGUE)).not.toContain("tatu5");
  });

  it("se puede cambiar por configuración, para el día que haya dominio propio", () => {
    enProduccion();
    process.env.URL_PUBLICA = "https://app.antifragil.es";
    expect(enlaceDelCliente(TOKEN, DESPLIEGUE)).toBe(`https://app.antifragil.es/mi/${TOKEN}`);
  });

  it("una barra de más en la configuración no parte el enlace", () => {
    enProduccion();
    process.env.URL_PUBLICA = "https://app.antifragil.es/";
    expect(enlaceDelCliente(TOKEN)).toBe(`https://app.antifragil.es/mi/${TOKEN}`);
  });

  it("en local sí usa el host real, para probar desde el móvil en la misma wifi", () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.URL_PUBLICA;

    expect(enlaceDelCliente(TOKEN, "192.168.1.17:3000")).toBe(
      `https://192.168.1.17:3000/mi/${TOKEN}`,
    );
    expect(enlaceDelCliente(TOKEN, "localhost:3000")).toBe(`http://localhost:3000/mi/${TOKEN}`);
  });
});

describe("cómo es el enlace que se copia", () => {
  it("es exactamente dominio público + /mi/ + token, sin nada más", () => {
    enProduccion();
    delete process.env.URL_PUBLICA;
    const enlace = enlaceDelCliente(TOKEN, DESPLIEGUE);

    expect(enlace).toBe(`${PUBLICA}/mi/${TOKEN}`);
    expect(enlace).not.toContain(" ");
    expect(enlace).not.toContain("#");
    expect(enlace).not.toContain("?");
    expect(enlace).not.toContain("localhost");
    expect(enlace).not.toContain("//mi/");
    expect(enlace.startsWith("https://")).toBe(true);
  });

  it("respeta el token tal cual, con sus guiones y guiones bajos", () => {
    enProduccion();
    // Los tokens llevan `-` y `_`: si alguien los «limpiara», el enlace
    // dejaría de abrir la ficha de nadie.
    for (const token of ["a_b-c", "y2OJPmBaJ_jWEt50w5AQM67M6x659upu", "SoloLetras123"]) {
      expect(enlaceDelCliente(token)).toBe(`${PUBLICA}/mi/${token}`);
    }
  });

  it("la ficha del cliente NO fabrica el enlace a mano", async () => {
    // Si alguien volviera a construirlo con el host de la petición, esto lo
    // caza: es el fallo exacto que le pidió una cuenta de Vercel a una clienta.
    const { readFileSync } = await import("node:fs");
    const pagina = readFileSync("src/app/clientes/[id]/page.tsx", "utf8");

    expect(pagina).toContain("enlaceDelCliente(");
    expect(pagina).not.toMatch(/`\$\{protocolo\}:\/\/\$\{anfitrion\}/);
  });
});
