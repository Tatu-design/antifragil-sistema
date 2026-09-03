/**
 * Firmar una sesión tiene que ser barato.
 *
 * NACE DE UN FALLO REAL (2026-08-27, 19:12). Fernando intentó firmar una sesión
 * y le salió «Algo ha fallado. No se ha guardado nada». En el registro del
 * servidor:
 *
 *   (EMAXCONNSESSION) max clients reached in session mode
 *                     — max clients are limited to pool_size: 15
 *   at perfilPorCorreo
 *
 * Se habían agotado las conexiones a la base de datos. Dos cosas lo provocaban,
 * y las dos se arreglan aquí:
 *
 *   1. Cada instancia de la aplicación pedía hasta 3 conexiones de las 15 que
 *      hay para todos. Vercel levanta una instancia por tanda de peticiones:
 *      con cinco a la vez, cupo agotado.
 *
 *   2. Firmar hacía 19 consultas y tardaba 7 segundos, y **una consulta más
 *      por cada cliente que se diera de alta**: la comprobación posterior
 *      pedía las sesiones cliente a cliente para mirar una sola semana. Siete
 *      segundos de conexión ocupada, en cada firma, multiplicando el problema.
 *
 * Lo que se prueba: que firmar no vuelve a crecer con el número de clientes, y
 * que quedarse sin cupo se reintenta en vez de estrellarse.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { repositorio } from "@/repositories";
import { reiniciarStagingParaPruebas } from "@/repositories/staging";
import { firmarSesion } from "@/services/sesiones";
import { verificarSemana } from "@/services/verificacion";

/** Cuenta cada método del repositorio que va a la base. */
function contarConsultas() {
  const real = repositorio() as unknown as Record<string, unknown>;
  const cuenta: Record<string, number> = {};
  const EN_MEMORIA = new Set(["constructor", "transaccion", "conCobroReal", "aCargo", "cargosDe"]);

  for (const nombre of Object.getOwnPropertyNames(Object.getPrototypeOf(real))) {
    if (EN_MEMORIA.has(nombre)) continue;
    const metodo = real[nombre];
    if (typeof metodo !== "function") continue;
    real[nombre] = (...args: unknown[]) => {
      cuenta[nombre] = (cuenta[nombre] ?? 0) + 1;
      return (metodo as (...a: unknown[]) => unknown).apply(real, args);
    };
  }
  return {
    total: () => Object.values(cuenta).reduce((a, b) => a + b, 0),
    de: (nombre: string) => cuenta[nombre] ?? 0,
    todo: () => ({ ...cuenta }),
  };
}

/** Da de alta clientes con bono, para ver si el coste crece con ellos. */
async function crearClientes(cuantos: number) {
  const repo = repositorio();
  for (let i = 0; i < cuantos; i += 1) {
    const id = randomUUID();
    await repo.crearCliente(
      {
        id,
        nombre: `Cliente de prueba ${i}`,
        estado: "activo",
        token: `tok-prueba-${i}`,
        pendientePago: false,
        sesionesCompletadas: 0,
        cicloActual: 1,
        profesionalId: "per-admin",
      },
      {
        clienteId: id,
        ciclo: 1,
        modalidad: "bono",
        servicio: "Bono 8 sesiones",
        tarifa: 40,
        sesionesTotales: 8,
        precioTotal: 320,
        cuotaMensual: null,
        sesionesReferencia: null,
        anio: null,
        mes: null,
        fechaInicio: "2026-08-01",
        fechaFin: null,
        pagado: true,
      },
    );
  }
}

describe("firmar una sesión", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("no cuesta más consultas por tener más clientes", async () => {
    // EL FALLO, REPRODUCIDO. Antes, cada cliente nuevo añadía una consulta a
    // CADA firma: con nueve clientes ya eran 19 consultas y siete segundos.
    const antes = contarConsultas();
    await firmarSesion("cli-a", { fecha: "2026-08-27" });
    const conPocos = antes.total();

    await reiniciarStagingParaPruebas();
    await crearClientes(20);

    const despues = contarConsultas();
    await firmarSesion("cli-a", { fecha: "2026-08-27" });

    expect(
      despues.total(),
      `con 20 clientes más hizo ${despues.total()} consultas en vez de ${conPocos}: ${JSON.stringify(despues.todo())}`,
    ).toBe(conPocos);
  });

  it("no pide las sesiones cliente a cliente", async () => {
    // Es la forma concreta que tenía el problema: un `listarSesiones` por cada
    // cliente de la lista.
    await crearClientes(20);
    const contador = contarConsultas();
    await firmarSesion("cli-a", { fecha: "2026-08-27" });

    expect(contador.de("listarSesiones")).toBe(0);
    expect(contador.de("listarClientes")).toBe(0);
  });

  it("y se queda en un puñado de consultas, no en veinte", async () => {
    await crearClientes(20);
    const contador = contarConsultas();
    await firmarSesion("cli-a", { fecha: "2026-08-27" });

    expect(
      contador.total(),
      `firmar hizo ${contador.total()} consultas: ${JSON.stringify(contador.todo())}`,
    ).toBeLessThanOrEqual(12);
  });
});

describe("la comprobación de descuadre", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("mira la semana entera de una vez", async () => {
    await crearClientes(20);
    const contador = contarConsultas();
    await verificarSemana("2026-08-27");

    expect(contador.de("listarSesiones")).toBe(0);
    expect(contador.total()).toBeLessThanOrEqual(3);
  });

  it("sigue sumando lo mismo que sumaba antes", async () => {
    // El atajo no puede cambiar la cuenta: es lo que decide si salta un aviso
    // de descuadre.
    const repo = repositorio();
    await firmarSesion("cli-a", { fecha: "2026-08-27" }); // bono de 45 €
    await firmarSesion("cli-b", { fecha: "2026-08-27" }); // mensualidad, sin importe

    const resumen = await repo.resumenDeSesionesEntre("2026-08-24", "2026-08-30");

    expect(resumen.facturacion).toBe(45);
    expect(resumen.horas).toBe(1);
    expect(resumen.horasSinImporte).toBe(1);
  });

  it("no cuenta lo que cae fuera de la semana", async () => {
    const repo = repositorio();
    await firmarSesion("cli-a", { fecha: "2026-08-27" });
    await firmarSesion("cli-a", { fecha: "2026-09-05" });

    const resumen = await repo.resumenDeSesionesEntre("2026-08-24", "2026-08-30");
    expect(resumen.horas).toBe(1);
  });

  it("una semana sin nada suma cero, no falla", async () => {
    const resumen = await repositorio().resumenDeSesionesEntre("2019-01-01", "2019-01-07");
    expect(resumen).toEqual({ facturacion: 0, horas: 0, horasSinImporte: 0 });
  });
});

describe("las conexiones a la base de datos", () => {
  const fuente = readFileSync(
    path.join(process.cwd(), "src", "repositories", "postgres.ts"),
    "utf8",
  );

  it("pide unas pocas conexiones: ni una ni un montón", () => {
    // Estuvo en 1 mientras la base iba en modo sesión, donde solo había 15
    // conexiones para TODA la aplicación: con tres por instancia, cinco
    // instancias agotaban el cupo y la sexta se estrellaba.
    //
    // Desde el 2026-08-30 la base va en modo transacción —medido: aguanta 45 a
    // la vez— y quedarse en una salía caro: con una sola conexión todas las
    // consultas de una pantalla van EN FILA aunque el código las lance a la
    // vez. Medido con las conexiones ya abiertas, siete consultas como las de
    // la lista de clientes: 332 ms con una, 95 ms con cuatro, 51 ms con siete.
    //
    // Lo que se vigila es el rango, no el número exacto: ni 1, que serializa,
    // ni tantas que un puñado de instancias vuelva a dejar sin sitio a las
    // demás.
    const max = Number(/max:\s*(\d+),/.exec(fuente)?.[1]);
    expect(max, "hay que declarar cuántas conexiones pide cada instancia").toBeGreaterThanOrEqual(3);
    expect(max, "demasiadas por instancia vuelven a agotar el cupo compartido").toBeLessThanOrEqual(8);
  });

  it("no se queda una conexión agarrada un minuto sin usarla", () => {
    expect(fuente).toMatch(/idleTimeoutMillis:\s*25_000/);
  });

  it("quedarse sin cupo se reintenta, no se le enseña al usuario", () => {
    // Es lo más transitorio que hay: en cuanto otra instancia termina, sobra
    // sitio. Antes se lanzaba a la primera.
    expect(fuente).toContain('"max clients reached"');
  });

  it("pero no se tapa el cajón de sastre de PostgreSQL", () => {
    // `XX000` es genérico: reintentarlo entero escondería errores de verdad.
    expect(fuente).not.toMatch(/TRANSITORIOS[\s\S]{0,400}"XX000"/);
  });
});
