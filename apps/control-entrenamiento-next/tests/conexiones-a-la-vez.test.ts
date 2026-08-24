/**
 * Dos cosas a la vez no pueden pisarse la conexión.
 *
 * NACE DE UN CUELGUE REAL (2026-08-24). A Fernando se le quedó la aplicación en
 * «Guardando…» dos veces al firmar una sesión. La sesión se había guardado —la
 * lista ya decía 7 de 16— pero la ficha seguía en 6 y el botón no volvía nunca.
 *
 * La causa era una variable suelta del módulo, `let enCurso`, que decía «la
 * conexión de la transacción en curso es esta». Vale mientras solo pasa una
 * cosa a la vez; deja de valer en cuanto hay dos, que es lo normal: mientras se
 * guarda la sesión, el navegador ya está pidiendo la lista de clientes.
 *
 * La segunda petición leía esa nota, mandaba sus consultas por la conexión de
 * la primera y acababa metida en una transacción ajena. Cuando la primera
 * terminaba y devolvía la conexión al montón, la segunda se quedaba hablando
 * con una conexión que ya no era suya: la consulta no volvía nunca. Con solo
 * tres conexiones disponibles, tres cuelgues dejan la aplicación entera parada.
 *
 * Estas pruebas fallan con el mecanismo antiguo y pasan con el de ahora.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { conConexion, conexionEnCurso } from "@/repositories/conexion-en-curso";

const espera = (ms: number) => new Promise((sigue) => setTimeout(sigue, ms));

describe("dos peticiones a la vez", () => {
  it("cada una usa SU conexión, no la de la otra", async () => {
    // EL CUELGUE, REPRODUCIDO. Con la variable suelta, «B» acababa usando la
    // conexión de «A».
    const usadas: string[] = [];
    const anota = (quien: string) => usadas.push(`${quien} usa ${conexionEnCurso<string>() ?? "el montón"}`);

    await Promise.all([
      // A abre su transacción y se queda esperando a la base de datos.
      conConexion("conexión-A", async () => {
        await espera(20);
        anota("A");
      }),
      // B llega justo en medio, como el navegador pidiendo la lista.
      (async () => {
        await espera(5);
        await conConexion("conexión-B", async () => anota("B"));
      })(),
    ]);

    expect(usadas).toEqual(["B usa conexión-B", "A usa conexión-A"]);
  });

  it("quien no está en una transacción no ve la de nadie", async () => {
    // Es lo que hace que una consulta normal vaya al montón de conexiones y no
    // se cuele dentro de la transacción de otro.
    const fuera: (string | null)[] = [];

    await Promise.all([
      conConexion("conexión-A", async () => {
        await espera(15);
      }),
      (async () => {
        await espera(5);
        fuera.push(conexionEnCurso<string>());
      })(),
    ]);

    expect(fuera).toEqual([null]);
  });

  it("al terminar no queda nada colgando", async () => {
    await conConexion("conexión-A", async () => espera(1));
    expect(conexionEnCurso()).toBeNull();
  });

  it("y tampoco si la transacción falla", async () => {
    await expect(
      conConexion("conexión-A", async () => {
        throw new Error("algo salió mal");
      }),
    ).rejects.toThrow("algo salió mal");

    expect(conexionEnCurso()).toBeNull();
  });

  it("una transacción dentro de otra sigue usando la misma conexión", async () => {
    // Es a propósito: guardar una sesión hace varias escrituras y todas tienen
    // que ir juntas, o ninguna.
    let dentro: string | null = null;
    await conConexion("conexión-A", async () => {
      await conConexion(conexionEnCurso<string>() ?? "otra", async () => {
        dentro = conexionEnCurso<string>();
      });
    });
    expect(dentro).toBe("conexión-A");
  });

  it("diez firmas a la vez no se mezclan ni una", async () => {
    // El caso de verdad: varias pantallas abiertas, o una firma mientras la
    // lista se está recargando.
    const resultados = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        conConexion(`conexión-${i}`, async () => {
          await espera(Math.random() * 20);
          return conexionEnCurso<string>();
        }),
      ),
    );

    expect(resultados).toEqual(Array.from({ length: 10 }, (_, i) => `conexión-${i}`));
  });
});

describe("el repositorio lo usa de verdad", () => {
  const fuente = readFileSync(path.join(process.cwd(), "src", "repositories", "postgres.ts"), "utf8");

  it("no queda ninguna variable de módulo con la conexión", () => {
    // Si vuelve a aparecer, vuelve el cuelgue.
    expect(fuente).not.toMatch(/let\s+enCurso/);
    expect(fuente).toContain("conexionEnCurso");
    expect(fuente).toContain("conConexion(conexion");
  });

  it("ninguna consulta puede esperar para siempre", () => {
    // Sin límite, una conexión que muere en silencio deja la pantalla en
    // «Guardando…» hasta que la persona cierra la aplicación.
    expect(fuente).toMatch(/statement_timeout:\s*8_000/);
    expect(fuente).toMatch(/query_timeout:\s*8_000/);
  });

  it("la conexión se devuelve siempre, salga bien o mal", () => {
    expect(fuente).toMatch(/finally\s*\{\s*\n\s*conexion\.release\(\);/);
  });
});
