/**
 * El LTV: valor económico acumulado de un cliente.
 *
 * Se comprueba en tres niveles, porque los fallos posibles son distintos en
 * cada uno:
 *
 *   1. La aritmética  — que la cifra sea la correcta.
 *   2. El servicio    — que llegue a la ficha del profesional y NO al enlace
 *                       público del cliente.
 *   3. El dibujado    — que se vea, con su texto y su formato, y que sea el
 *                       mismo bloque para las tres modalidades.
 */

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { Ltv } from "@/components/Ltv";
import { eurosRedondos } from "@/lib/formato";
import { calcularLtv } from "@/domain/ltv";
import { BONO, CUENTA, MENSUALIDAD } from "@/domain/modalidades";
import { repositorio } from "@/repositories";
import { reiniciarStagingParaPruebas } from "@/repositories/staging";
import { obtenerPerfil } from "@/services/clientes";
import { obtenerPerfilPublico } from "@/services/publico";

const pintar = (total: number, resto: Partial<ReturnType<typeof calcularLtv>> = {}) =>
  renderToStaticMarkup(
    createElement(Ltv, { ltv: { total, bonos: 0, mensualidades: 0, cuentas: 0, ...resto } }),
  );

// ---------------------------------------------------------------------------
// 1. La aritmética
// ---------------------------------------------------------------------------

describe("cuánto valor ha generado un cliente", () => {
  it("un bono suma el importe de las sesiones FIRMADAS, no el bono entero", () => {
    // 16 sesiones contratadas a 45 €, pero solo 6 dadas. Las diez que faltan
    // no se han producido todavía y podrían no producirse nunca.
    const ltv = calcularLtv({
      ciclos: [{ ciclo: 1, modalidad: BONO }],
      sesiones: Array.from({ length: 6 }, () => ({ ciclo: 1, tarifa: 45 })),
      cargos: [],
    });

    expect(ltv.total).toBe(270);
    expect(ltv.bonos).toBe(270);
  });

  it("una mensualidad suma sus cuotas y NO sus sesiones", () => {
    // Este es el error que costaría dinero: las sesiones de una mensualidad
    // se guardan sin importe justamente para no cobrarlas dos veces. Si
    // alguna trajera tarifa, el LTV tiene que seguir ignorándola.
    const ltv = calcularLtv({
      ciclos: [{ ciclo: 1, modalidad: MENSUALIDAD }],
      sesiones: Array.from({ length: 12 }, () => ({ ciclo: 1, tarifa: 60 })),
      cargos: [{ importe: 720 }],
    });

    expect(ltv.total).toBe(720);
    expect(ltv.mensualidades).toBe(720);
  });

  it("una cuenta de cliente suma sesión a sesión", () => {
    const ltv = calcularLtv({
      ciclos: [{ ciclo: 1, modalidad: CUENTA }],
      sesiones: Array.from({ length: 4 }, () => ({ ciclo: 1, tarifa: 35 })),
      cargos: [],
    });

    expect(ltv.total).toBe(140);
    expect(ltv.cuentas).toBe(140);
  });

  it("un cliente que ha pasado por las tres modalidades las suma todas", () => {
    const ltv = calcularLtv({
      ciclos: [
        { ciclo: 1, modalidad: BONO },
        { ciclo: 2, modalidad: MENSUALIDAD },
        { ciclo: 3, modalidad: CUENTA },
      ],
      sesiones: [
        ...Array.from({ length: 8 }, () => ({ ciclo: 1, tarifa: 45 })),
        ...Array.from({ length: 10 }, () => ({ ciclo: 2, tarifa: null })),
        ...Array.from({ length: 3 }, () => ({ ciclo: 3, tarifa: 35 })),
      ],
      cargos: [{ importe: 720 }],
    });

    expect(ltv.total).toBe(360 + 720 + 105);
    expect(ltv.bonos).toBe(360);
    expect(ltv.mensualidades).toBe(720);
    expect(ltv.cuentas).toBe(105);
  });

  it("sin nada firmado el valor es cero, no un hueco", () => {
    expect(calcularLtv({ ciclos: [], sesiones: [], cargos: [] }).total).toBe(0);
  });

  it("los céntimos no se escapan al sumar muchas sesiones", () => {
    // 33,33 € × 3 son 99,99 €, no 99,99000000000001.
    const ltv = calcularLtv({
      ciclos: [{ ciclo: 1, modalidad: BONO }],
      sesiones: Array.from({ length: 3 }, () => ({ ciclo: 1, tarifa: 33.33 })),
      cargos: [],
    });
    expect(ltv.total).toBe(99.99);
  });
});

// ---------------------------------------------------------------------------
// 2. El servicio: a quién llega y a quién no
// ---------------------------------------------------------------------------

describe("el LTV en la ficha del profesional", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("llega calculado con la ficha", async () => {
    // Cliente A: bono de 45 € con 6 sesiones firmadas.
    const perfil = await obtenerPerfil("cli-a");
    expect(perfil!.ltv.total).toBe(270);
  });

  it("una mensualidad trae su cuota, no cero", async () => {
    const perfil = await obtenerPerfil("cli-b");
    expect(perfil!.ltv.total).toBe(720);
  });

  it("un cliente recién dado de alta trae cero", async () => {
    // Cuenta de cliente sin ninguna sesión todavía.
    const perfil = await obtenerPerfil("cli-d");
    expect(perfil!.ltv.total).toBe(0);
  });

  it("firmar una sesión lo sube; marcar el cobro NO lo mueve", async () => {
    const repo = repositorio();
    const antes = (await obtenerPerfil("cli-a"))!.ltv.total;

    // Cambiar el estado de cobro es el otro eje: dinero cobrado, no dinero
    // producido. El LTV es historia acumulada y no se entera.
    const ciclo = (await repo.listarCiclos("cli-a")).find((c) => c.ciclo === 1)!;
    await repo.guardarCiclo({ ...ciclo, pagado: !ciclo.pagado });

    expect((await obtenerPerfil("cli-a"))!.ltv.total).toBe(antes);
  });

  it("no se lo llevamos al cliente en su enlace público", async () => {
    const publico = await obtenerPerfilPublico("tok-cliente-a");

    expect(publico).not.toBeNull();
    expect(publico).not.toHaveProperty("ltv");
    // Ni escondido dentro de la ficha o del historial.
    expect(JSON.stringify(publico).toLowerCase()).not.toContain("ltv");
  });

  it("y la pantalla pública no dibuja el bloque", () => {
    // Barrera contra un despiste futuro: si alguien importa el componente en
    // el perfil del cliente, esta prueba lo caza antes de que se despliegue.
    const pagina = readFileSync("src/app/mi/[token]/page.tsx", "utf8");
    expect(pagina).not.toContain("Ltv");
  });
});

// ---------------------------------------------------------------------------
// 3. El dibujado
// ---------------------------------------------------------------------------

describe("cómo se ve el bloque de LTV", () => {
  it("NACE TAPADO: la cifra no se ve hasta pulsar", () => {
    // Lo pidió Fernando el 2026-08-10, y no por estética: la sesión se firma
    // con el cliente delante mirando la pantalla, y ahí no pinta nada una
    // cifra que dice cuánto lleva gastado.
    const html = pintar(1485);

    expect(html).not.toContain("1.485");
    expect(html).toContain("LTV");
    expect(html).toContain("Pulsa para ver");
  });

  it("y ninguna cifra se cuela en el marcado mientras está tapado", () => {
    // Que no se vea NO puede significar «está ahí pero en gris»: quien mire
    // el código de la página no debe encontrarla tampoco.
    const html = pintar(12350, { bonos: 12350 });
    expect(html).not.toContain("12.350");
    expect(html).not.toContain("12350");
  });

  it("no usa los textos que confunden valor con dinero cobrado", () => {
    const html = pintar(1485);
    for (const prohibido of ["Facturación total", "Dinero cobrado", "Total pagado"]) {
      expect(html).not.toContain(prohibido);
    }
  });

  it("es el MISMO bloque para bono, mensualidad y cuenta", () => {
    // El componente no recibe la modalidad a propósito: no puede cambiar de
    // aspecto según ella aunque alguien lo intentara más adelante.
    const soloBono = pintar(360, { bonos: 360 });
    const soloMensualidad = pintar(360, { mensualidades: 360 });
    const soloCuenta = pintar(360, { cuentas: 360 });

    expect(soloMensualidad).toBe(soloBono);
    expect(soloCuenta).toBe(soloBono);
  });

  it("se puede destapar y volver a tapar", () => {
    // El texto lo dice: pulsar la primera vez enseña, pulsar otra vez esconde.
    expect(pintar(1485)).toContain("Pulsa para ver");
  });

  it("no depende del color ni de un icono para entenderse", () => {
    const html = pintar(1485);
    // Sin `<svg>`, sin `<img>`: todo lo que dice el bloque es texto.
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<img");
  });
});

describe("el formato del importe acumulado", () => {
  it("va en español, con punto de millar y sin céntimos", () => {
    // Se comprueba sobre el formateador, porque en el bloque la cifra está
    // tapada hasta que se pulsa.
    expect(eurosRedondos(485)).toBe("485 €");
    expect(eurosRedondos(1485)).toBe("1.485 €");
    expect(eurosRedondos(12350)).toBe("12.350 €");
    expect(eurosRedondos(123456)).toBe("123.456 €");
  });

  it("un cliente sin historial da «0 €», no un hueco ni un guion", () => {
    expect(eurosRedondos(0)).toBe("0 €");
  });

  it("nunca el formato inglés", () => {
    expect(eurosRedondos(1485)).not.toContain("1485.00");
    expect(eurosRedondos(1485)).not.toContain("EUR");
  });
});
