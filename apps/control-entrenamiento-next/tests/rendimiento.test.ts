/**
 * Puerta de rendimiento: cuántos viajes a la base hace cada pantalla.
 *
 * En Vercel la base no está al lado, está en Supabase: **cada consulta cuesta
 * unos 180 ms de red**. Lo caro no es la consulta, es cuántas hay y si se
 * esperan unas a otras. Una pantalla que pide datos cliente a cliente tarda
 * segundos aunque cada consulta sea trivial — le pasó a la lista de clientes,
 * que llegó a hacer 41 consultas y tardar más de 7 segundos (2026-08-05).
 *
 * Por eso aquí no se mide tiempo (que depende de la red del día), sino el
 * NÚMERO DE CONSULTAS, que es lo que de verdad controla el código. Si una
 * pantalla se pasa del presupuesto, esta prueba falla y hay que mirar por qué
 * antes de entregar.
 *
 * Regla que protege, en palabras de Fernando: «al hacer cambios asegúrate de
 * que todo el funcionamiento siga óptimo, entre otras cosas la velocidad».
 */

import { beforeEach, describe, expect, it } from "vitest";

import { repositorio } from "@/repositories";
import { reiniciarStagingParaPruebas } from "@/repositories/staging";
import { listarClientes, obtenerPerfil } from "@/services/clientes";
import { contarNoLeidos } from "@/services/avisos";
import { obtenerCuenta } from "@/services/clases";
import { obtenerEconomia } from "@/services/economia";
import { obtenerPerfilPublico } from "@/services/publico";

/**
 * Envuelve el repositorio y cuenta cada método que toca la base.
 *
 * No distingue si dos consultas van en paralelo: cuenta viajes. Menos viajes
 * siempre es mejor, y las que quedan ya se lanzan a la vez donde se puede.
 */
function contarConsultas(): { total: () => number; porMetodo: () => Record<string, number> } {
  const real = repositorio() as unknown as Record<string, unknown>;
  const cuenta: Record<string, number> = {};

  // Ayudantes que trabajan en memoria y NO van a la base: contarlos falsearía
  // la medida.
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
    porMetodo: () => ({ ...cuenta }),
  };
}

/** Presupuestos. Subir uno exige explicar por qué compensa. */
const PRESUPUESTO = {
  "lista de clientes": 3,
  "perfil de un cliente": 4,
  "perfil público del cliente": 5,
  /** Bajó de 8 a 5 el 2026-08-08: la pantalla dejó de enseñar la semana, así
   *  que dejó de pedir `listarSemanas` y `contarClases`. Son un viaje de red
   *  para los meses con datos y uno más para el mes en curso. */
  economía: 5,
  "ficha de una cuenta de CrossFit": 2,
  /** La pantalla entera: clientes, avisos y las dos cuentas de CrossFit.
   *  Las cuatro cargas se lanzan a la vez, así que en tiempo es como una. */
  "pantalla de clientes completa": 6,
};

describe("presupuesto de consultas por pantalla", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("la lista de clientes no crece con el número de clientes", async () => {
    const contador = contarConsultas();
    await listarClientes();

    expect(
      contador.total(),
      `la lista hizo ${contador.total()} consultas: ${JSON.stringify(contador.porMetodo())}`,
    ).toBeLessThanOrEqual(PRESUPUESTO["lista de clientes"]);
  });

  it("y sigue sin crecer con el doble de clientes", async () => {
    // La prueba que de verdad importa: si alguien vuelve a meter una consulta
    // por cliente, aquí se dispara aunque el presupuesto de arriba aguantara.
    const repo = repositorio();
    const original = await repo.listarClientes();
    for (const cliente of original) {
      await repo.crearCliente(
        { ...cliente, id: `${cliente.id}-bis`, nombre: `${cliente.nombre} bis`, token: `${cliente.token}bis` },
        { ...(await repo.cicloActual(cliente.id))!, clienteId: `${cliente.id}-bis` },
      );
    }

    const contador = contarConsultas();
    await listarClientes();

    expect(
      contador.total(),
      `con el doble de clientes hizo ${contador.total()} consultas: ${JSON.stringify(contador.porMetodo())}`,
    ).toBeLessThanOrEqual(PRESUPUESTO["lista de clientes"]);
  });

  it("el perfil de un cliente", async () => {
    const [cliente] = await repositorio().listarClientes();
    const contador = contarConsultas();
    await obtenerPerfil(cliente.id);

    expect(
      contador.total(),
      `el perfil hizo ${contador.total()} consultas: ${JSON.stringify(contador.porMetodo())}`,
    ).toBeLessThanOrEqual(PRESUPUESTO["perfil de un cliente"]);
  });

  it("el perfil público, que el cliente abre desde el móvil", async () => {
    const [cliente] = await repositorio().listarClientes();
    const contador = contarConsultas();
    await obtenerPerfilPublico(cliente.token);

    expect(
      contador.total(),
      `el perfil público hizo ${contador.total()} consultas: ${JSON.stringify(contador.porMetodo())}`,
    ).toBeLessThanOrEqual(PRESUPUESTO["perfil público del cliente"]);
  });

  it("economía", async () => {
    const contador = contarConsultas();
    await obtenerEconomia();

    expect(
      contador.total(),
      `economía hizo ${contador.total()} consultas: ${JSON.stringify(contador.porMetodo())}`,
    ).toBeLessThanOrEqual(PRESUPUESTO.economía);
  });

  it("economía ya no pide las semanas ni las clases de la semana", async () => {
    const contador = contarConsultas();
    await obtenerEconomia();
    const porMetodo = contador.porMetodo();

    // Dos viajes de red que se pagaban para pintar una sección que ya no
    // existe (2026-08-08).
    expect(porMetodo.listarSemanas ?? 0).toBe(0);
    expect(porMetodo.contarClases ?? 0).toBe(0);
  });

  it("la pantalla de clientes entera, con sus dos cuentas de CrossFit", async () => {
    const contador = contarConsultas();
    // Lo mismo que carga `app/clientes/page.tsx`, y en paralelo igual que allí.
    await Promise.all([
      listarClientes(),
      contarNoLeidos(),
      obtenerCuenta("lidomare"),
      obtenerCuenta("kids"),
    ]);

    expect(
      contador.total(),
      `la pantalla hizo ${contador.total()} consultas: ${JSON.stringify(contador.porMetodo())}`,
    ).toBeLessThanOrEqual(PRESUPUESTO["pantalla de clientes completa"]);
  });

  it("la ficha de una cuenta de CrossFit", async () => {
    const contador = contarConsultas();
    await obtenerCuenta("kids");

    expect(
      contador.total(),
      `la ficha de Kids hizo ${contador.total()} consultas: ${JSON.stringify(contador.porMetodo())}`,
    ).toBeLessThanOrEqual(PRESUPUESTO["ficha de una cuenta de CrossFit"]);
  });
});

describe("ninguna pantalla pide datos cliente a cliente", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("la lista no llama a cicloActual ni a contarSesionesDelCiclo", async () => {
    const contador = contarConsultas();
    await listarClientes();
    const porMetodo = contador.porMetodo();

    // Estos dos son de UN cliente: llamarlos desde la lista significa un
    // viaje de red por cada uno, que es justo lo que la dejó en 7 segundos.
    expect(porMetodo.cicloActual ?? 0).toBe(0);
    expect(porMetodo.contarSesionesDelCiclo ?? 0).toBe(0);
    expect(porMetodo.listarCiclos ?? 0).toBe(0);
  });
});
