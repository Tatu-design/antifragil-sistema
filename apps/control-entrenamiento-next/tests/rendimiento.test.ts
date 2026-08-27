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
import { obtenerCalendario } from "@/services/calendario";
import { obtenerEconomia } from "@/services/economia";
import { firmarSesion } from "@/services/sesiones";
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
  /**
   * Subió de 5 a 6 el 2026-08-10: la pantalla dice ahora quién le entrena, y
   * eso es una lectura más del perfil del profesional.
   *
   * Compensa porque **no cuesta espera**: va dentro de la misma tanda en
   * paralelo que las otras cuatro, que ya estaban ahí. Un viaje más de red que
   * ocurre a la vez que los demás no alarga la pantalla ni un milisegundo.
   */
  "perfil público del cliente": 6,
  /**
   * Bajó de 8 a 5 y de 5 a 1 el 2026-08-08.
   *
   * Primero dejó de enseñar la semana (fuera `listarSemanas` y `contarClases`).
   * Después dejó de pedir los meses uno a uno: eso costaba cinco viajes de red
   * POR MES, así que la pantalla se hacía más lenta sola cada vez que pasaba
   * un mes. Ahora es una sola llamada, y por eso el presupuesto es 1: si
   * alguna vez vuelve a subir, es que ha vuelto el problema.
   */
  economía: 1,
  "ficha de una cuenta de CrossFit": 2,
  /**
   * Un mes entero del calendario en UNA consulta, del día 1 al último.
   *
   * Es el presupuesto que importa de esta pantalla: pedir las sesiones día a
   * día serían treinta viajes para pintar una cuadrícula, y la pantalla se
   * haría más lenta cuanto más largo el mes. Si alguna vez sube de 1, es que
   * ha vuelto ese problema.
   */
  "calendario de un mes": 1,
  /** La pantalla entera: clientes, avisos y las dos cuentas de CrossFit.
   *  Las cuatro cargas se lanzan a la vez, así que en tiempo es como una. */
  "pantalla de clientes completa": 6,
};

describe("presupuesto de consultas por pantalla", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("el calendario pide el mes de una vez, no día a día", async () => {
    const contador = contarConsultas();
    await obtenerCalendario({ anio: 2026, mes: 8, profesionalId: null, adminId: "per-admin" });

    expect(
      contador.total(),
      `el calendario hizo ${contador.total()} consultas: ${JSON.stringify(contador.porMetodo())}`,
    ).toBeLessThanOrEqual(PRESUPUESTO["calendario de un mes"]);
  });

  it("y mirar el de un profesional no cuesta ni una consulta más", async () => {
    // Es la misma consulta con una condición más, no una segunda pasada.
    const contador = contarConsultas();
    await obtenerCalendario({ anio: 2026, mes: 8, profesionalId: "per-rafa", adminId: "per-admin" });

    expect(contador.total()).toBeLessThanOrEqual(PRESUPUESTO["calendario de un mes"]);
  });

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

  it("economía de UN profesional cuesta lo mismo que la global", async () => {
    // Mirar por profesional no puede costar consultas de más: es la misma
    // llamada con un filtro dentro, no una economía aparte.
    //
    // El contador envuelve los métodos del repositorio y no los devuelve a su
    // sitio, así que solo puede usarse UNA vez por prueba: por eso el
    // presupuesto se comprueba aquí y la comparación entre profesionales va en
    // la prueba siguiente.
    const contador = contarConsultas();
    await obtenerEconomia({ profesionalId: "per-rafa" });

    expect(
      contador.total(),
      `economía de un profesional hizo ${contador.total()} consultas`,
    ).toBeLessThanOrEqual(PRESUPUESTO.economía);
  });

  it("y no crece al haber más profesionales", async () => {
    // Con tres en los datos de prueba, pedir la de uno cuesta lo mismo que
    // pedir la de otro: no se calcula la de todos para enseñar una.
    const contador = contarConsultas();
    await obtenerEconomia({ profesionalId: "per-otro" });

    expect(contador.total()).toBeLessThanOrEqual(PRESUPUESTO.economía);
  });

  it("ninguna pantalla incrusta la foto de un perfil", async () => {
    // La foto pesa unos 18 KB. Incrustada en la página viajaba dos o tres
    // veces en CADA carga —el 62 % del peso de la lista de clientes— y se
    // volvía a descargar en cada visita (2026-08-12). Va por su dirección.
    const { readFileSync, readdirSync } = await import("node:fs");
    const path = await import("node:path");

    const raiz = path.join(process.cwd(), "src");
    const archivos: string[] = [];
    const recorrer = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const completo = path.join(dir, e.name);
        if (e.isDirectory()) recorrer(completo);
        else if (/\.tsx?$/.test(e.name)) archivos.push(completo);
      }
    };
    recorrer(raiz);

    // Nadie pasa `foto` de un perfil a un componente salvo el propio panel,
    // que necesita enseñar la que se acaba de elegir del móvil.
    const permitidos = ["PanelPerfil.tsx", "foto-perfil.ts", "route.ts", "postgres.ts", "staging.ts", "tipos.ts", "actions.ts"];
    const culpables = archivos.filter((f) => {
      if (permitidos.some((p) => f.endsWith(p))) return false;
      return /foto=\{(usuario|perfil|profesional)\.foto\}/.test(readFileSync(f, "utf8"));
    });

    expect(culpables.map((f) => path.basename(f))).toEqual([]);
  });

  it("economía no se hace más lenta según pasan los meses", async () => {
    // Esta es la prueba que de verdad importa. Un presupuesto fijo se puede
    // cumplir hoy y romperse solo en diciembre si el coste depende de cuántos
    // meses lleve el negocio funcionando. Aquí se mide con pocos meses y con
    // muchos, y tiene que costar lo mismo.
    const contador = contarConsultas();
    await obtenerEconomia();
    const conPocosMeses = contador.total();

    // Un año y medio largo de historia repartida por meses distintos.
    for (let i = 0; i < 20; i += 1) {
      const mes = String((i % 12) + 1).padStart(2, "0");
      await firmarSesion("cli-a", { fecha: `${2024 + Math.floor(i / 12)}-${mes}-05` });
    }

    const contador2 = contarConsultas();
    await obtenerEconomia();

    expect(
      contador2.total(),
      `con más meses pasó de ${conPocosMeses} a ${contador2.total()} consultas: el coste crece con el tiempo`,
    ).toBe(conPocosMeses);
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
