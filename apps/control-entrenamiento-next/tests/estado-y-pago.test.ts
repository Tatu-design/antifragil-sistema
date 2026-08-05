/**
 * Estado del cliente y estado de pago: dos ejes independientes (2026-08-05).
 *
 * Regla de negocio de Fernando, y la fuente de verdad de todo este archivo:
 *
 * - Estado del cliente: `activo`, `pausado` o `cancelado`. Habla de la
 *   continuidad dentro del servicio.
 * - Estado de pago: pagado o pendiente. Habla SOLO de si hay deuda. No existe
 *   «no se sabe», ni triestado, ni nulo.
 * - Las seis combinaciones son válidas. Pausar o cancelar NO borra la deuda.
 * - Todo servicio nuevo nace pendiente de pago, sea de la modalidad que sea, y
 *   solo pasa a pagado con una acción explícita.
 * - Un servicio creado por renovación NUNCA hereda el cobro del anterior.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { repositorio } from "@/repositories";
import { reiniciarStagingParaPruebas } from "@/repositories/staging";
import {
  cambiarEstado,
  configurarServicio,
  crearCliente,
  listarClientes,
  marcarCobro,
  obtenerPerfil,
} from "@/services/clientes";
import { diagnosticar, reparar } from "@/services/reparacion";
import { firmarSesion } from "@/services/sesiones";
import type { Estado } from "@/domain/tipos";

const BONO = "cli-a"; // bono de 8 × 45 €

/** Un cliente nuevo con un bono pequeño, para agotarlo rápido. */
async function altaBono(nombre: string, sesiones = 2) {
  return crearCliente({
    nombre,
    servicio: "Bono corto",
    modalidad: "bono",
    sesionesTotales: sesiones,
    precioTotal: sesiones * 40,
    cuotaMensual: null,
    sesionesReferencia: null,
    tarifa: null,
  });
}

async function cicloActual(clienteId: string) {
  return (await repositorio().cicloActual(clienteId))!;
}

async function ciclos(clienteId: string) {
  return (await repositorio().listarCiclos(clienteId)).sort((a, b) => a.ciclo - b.ciclo);
}

async function enLista(clienteId: string) {
  return (await listarClientes()).find((c) => c.id === clienteId)!;
}

/** Deja al cliente en el estado y la deuda pedidos, sin tocar nada más. */
async function situar(clienteId: string, estado: Estado, pagado: boolean) {
  const ciclo = await cicloActual(clienteId);
  await marcarCobro(clienteId, ciclo.ciclo, pagado);
  await cambiarEstado(clienteId, estado);
}

describe("las seis combinaciones de estado y pago", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  const casos: Array<[Estado, boolean]> = [
    ["activo", true],
    ["activo", false],
    ["pausado", true],
    ["pausado", false],
    ["cancelado", true],
    ["cancelado", false],
  ];

  for (const [estado, pagado] of casos) {
    it(`${estado} + ${pagado ? "pagado" : "pendiente de pago"}`, async () => {
      const cliente = await altaBono(`Cliente ${estado} ${pagado}`);
      await situar(cliente.id, estado, pagado);

      const fila = await enLista(cliente.id);
      expect(fila.estado).toBe(estado);
      expect(fila.debe).toBe(!pagado);
      // Los dos ejes se leen por separado y no se deducen uno del otro.
      expect((await cicloActual(cliente.id)).pagado).toBe(pagado);
    });
  }
});

describe("pausar y cancelar no tocan la deuda", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("pausar no elimina la deuda", async () => {
    const cliente = await altaBono("Deudor pausado");
    await situar(cliente.id, "activo", false);

    await cambiarEstado(cliente.id, "pausado");

    expect((await cicloActual(cliente.id)).pagado).toBe(false);
    expect((await enLista(cliente.id)).debe).toBe(true);
  });

  it("cancelar no elimina la deuda", async () => {
    const cliente = await altaBono("Deudor cancelado");
    await situar(cliente.id, "activo", false);

    await cambiarEstado(cliente.id, "cancelado");

    expect((await cicloActual(cliente.id)).pagado).toBe(false);
    expect((await enLista(cliente.id)).debe).toBe(true);
  });

  it("volver a activo tampoco cambia la deuda", async () => {
    const cliente = await altaBono("Vuelve");
    await situar(cliente.id, "pausado", false);

    await cambiarEstado(cliente.id, "activo");

    expect((await cicloActual(cliente.id)).pagado).toBe(false);
    expect((await enLista(cliente.id)).debe).toBe(true);
  });

  it("un pausado que estaba al día sigue al día", async () => {
    const cliente = await altaBono("Pausado al dia");
    await situar(cliente.id, "activo", true);

    await cambiarEstado(cliente.id, "pausado");

    expect((await cicloActual(cliente.id)).pagado).toBe(true);
    expect((await enLista(cliente.id)).debe).toBe(false);
  });
});

describe("los pendientes de pago incluyen a todos", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("activos, pausados y cancelados con deuda salen todos", async () => {
    const activo = await altaBono("Debe activo");
    const pausado = await altaBono("Debe pausado");
    const cancelado = await altaBono("Debe cancelado");
    await situar(activo.id, "activo", false);
    await situar(pausado.id, "pausado", false);
    await situar(cancelado.id, "cancelado", false);

    const lista = await listarClientes();
    const deudores = lista.filter((c) => c.debe).map((c) => c.id);

    expect(deudores).toContain(activo.id);
    expect(deudores).toContain(pausado.id);
    expect(deudores).toContain(cancelado.id);
  });

  it("una deuda de un servicio YA CERRADO también cuenta, esté como esté el cliente", async () => {
    const cliente = await altaBono("Deuda vieja", 2);
    // Se agota el bono: se cierra pendiente y nace otro pendiente.
    await firmarSesion(cliente.id, { fecha: "2026-08-01" });
    await firmarSesion(cliente.id, { fecha: "2026-08-02" });
    // El de ahora se cobra; el cerrado sigue a deber.
    const actual = await cicloActual(cliente.id);
    await marcarCobro(cliente.id, actual.ciclo, true);
    await cambiarEstado(cliente.id, "cancelado");

    const fila = await enLista(cliente.id);
    expect(fila.ciclosPendientes).toBeGreaterThan(0);
    expect(fila.debe).toBe(true);
  });
});

describe("todo servicio nuevo nace pendiente de pago", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("un bono nuevo", async () => {
    const cliente = await altaBono("Bono nuevo");
    expect((await cicloActual(cliente.id)).pagado).toBe(false);
  });

  it("una mensualidad nueva", async () => {
    const cliente = await crearCliente({
      nombre: "Mensualidad nueva", servicio: "Mensualidad", modalidad: "mensualidad",
      cuotaMensual: 720, sesionesReferencia: 12, sesionesTotales: null, precioTotal: null, tarifa: null,
    });
    expect((await cicloActual(cliente.id)).pagado).toBe(false);
    expect((await enLista(cliente.id)).debe).toBe(true);
  });

  it("una cuenta de cliente nueva", async () => {
    const cliente = await crearCliente({
      nombre: "Cuenta nueva", servicio: "Cuenta", modalidad: "cuenta",
      tarifa: 35, sesionesTotales: null, precioTotal: null, cuotaMensual: null, sesionesReferencia: null,
    });
    expect((await cicloActual(cliente.id)).pagado).toBe(false);
    expect((await enLista(cliente.id)).debe).toBe(true);
  });

  it("al cambiar de modalidad, el servicio nuevo también nace pendiente", async () => {
    const cliente = await altaBono("Cambia de modalidad");
    await situar(cliente.id, "activo", true); // el actual, cobrado

    await configurarServicio(cliente.id, {
      modalidad: "cuenta", servicio: "Cuenta", tarifa: 35,
      sesionesTotales: null, precioTotal: null, cuotaMensual: null, sesionesReferencia: null,
    });

    expect((await cicloActual(cliente.id)).pagado).toBe(false);
  });

  it("marcar como pagado exige una acción explícita", async () => {
    const cliente = await altaBono("Explicito");
    expect((await cicloActual(cliente.id)).pagado).toBe(false);

    // Firmar, pausar, cancelar y reactivar NO lo cobran.
    await firmarSesion(cliente.id, { fecha: "2026-08-01" });
    await cambiarEstado(cliente.id, "pausado");
    await cambiarEstado(cliente.id, "activo");
    expect((await cicloActual(cliente.id)).pagado).toBe(false);

    // Solo esto lo cobra.
    const actual = await cicloActual(cliente.id);
    await marcarCobro(cliente.id, actual.ciclo, true);
    expect((await cicloActual(cliente.id)).pagado).toBe(true);
  });
});

describe("renovación automática de un bono", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  /** Agota un bono de 2 sesiones y devuelve sus ciclos. */
  async function agotar(pagadoAntes: boolean) {
    const cliente = await altaBono("Renovador", 2);
    await situar(cliente.id, "activo", pagadoAntes);
    await firmarSesion(cliente.id, { fecha: "2026-08-01" });
    await firmarSesion(cliente.id, { fecha: "2026-08-02" });
    return { cliente, lista: await ciclos(cliente.id) };
  }

  it("bono anterior PAGADO + renovación → el nuevo nace pendiente", async () => {
    const { lista } = await agotar(true);

    expect(lista).toHaveLength(2);
    expect(lista[0].pagado).toBe(true); // el cerrado conserva su historia
    expect(lista[1].pagado).toBe(false); // el nuevo nace debiendo
  });

  it("bono anterior PENDIENTE + renovación → el nuevo también pendiente", async () => {
    const { lista } = await agotar(false);

    expect(lista[0].pagado).toBe(false);
    expect(lista[1].pagado).toBe(false);
  });

  it("el bono cerrado conserva su estado histórico y su fecha de fin", async () => {
    const { lista } = await agotar(true);

    expect(lista[0].pagado).toBe(true);
    expect(lista[0].fechaFin).toBe("2026-08-02");
    expect(lista[1].fechaFin).toBeNull();
  });

  it("el bono nuevo empieza en 0 sesiones", async () => {
    const { cliente, lista } = await agotar(true);

    const perfil = await obtenerPerfil(cliente.id);
    const enCurso = perfil!.servicios.find((c) => c.esActual)!;
    expect(enCurso.ciclo).toBe(lista[1].ciclo);
    expect(enCurso.sesiones).toHaveLength(0);
    expect((await repositorio().obtenerCliente(cliente.id))!.sesionesCompletadas).toBe(0);
  });

  it("el bono nuevo conserva servicio, tarifa y número de sesiones", async () => {
    const { lista } = await agotar(true);

    expect(lista[1].servicio).toBe(lista[0].servicio);
    expect(lista[1].tarifa).toBe(lista[0].tarifa);
    expect(lista[1].sesionesTotales).toBe(lista[0].sesionesTotales);
  });

  it("una renovación nunca hereda el cobro, se repita las veces que se repita", async () => {
    const cliente = await altaBono("Renueva dos veces", 2);
    for (const fecha of ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"]) {
      // Cada vez que nace uno, se cobra a mano para probar que el siguiente
      // NO lo hereda.
      const actual = await cicloActual(cliente.id);
      await marcarCobro(cliente.id, actual.ciclo, true);
      await firmarSesion(cliente.id, { fecha });
    }
    const lista = await ciclos(cliente.id);
    expect(lista.length).toBeGreaterThanOrEqual(3);
    expect(lista[lista.length - 1].pagado).toBe(false);
  });

  it("el cliente queda marcado como pendiente tras renovar", async () => {
    const { cliente } = await agotar(true);
    expect((await enLista(cliente.id)).debe).toBe(true);
  });
});

describe("nada inventa cobros", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("la reparación de numeración no cambia ningún estado de pago", async () => {
    const repo = repositorio();
    const antes = new Map((await repo.listarCiclos(BONO)).map((c) => [c.ciclo, c.pagado]));

    // Se rompe la numeración a propósito y se repara.
    const sesiones = await repo.listarSesiones(BONO);
    if (sesiones.length > 0) {
      await repo.reubicarSesion(sesiones[0].id, sesiones[0].ciclo, sesiones[0].numeroSesion + 5);
      await reparar();
    }

    for (const ciclo of await repo.listarCiclos(BONO)) {
      expect(ciclo.pagado).toBe(antes.get(ciclo.ciclo));
    }
  });

  it("una segunda reparación no vuelve a modificar nada", async () => {
    const repo = repositorio();
    const sesiones = await repo.listarSesiones(BONO);
    if (sesiones.length > 0) {
      await repo.reubicarSesion(sesiones[0].id, sesiones[0].ciclo, sesiones[0].numeroSesion + 5);
    }
    await reparar();

    // A partir de aquí no queda nada que arreglar.
    expect(await diagnosticar()).toEqual([]);
    const foto = await repo.listarCiclos(BONO);
    await reparar();
    expect(await repo.listarCiclos(BONO)).toEqual(foto);
  });

  it("ningún ciclo queda con el cobro sin definir", async () => {
    for (const cliente of await repositorio().listarClientes()) {
      for (const ciclo of await repositorio().listarCiclos(cliente.id)) {
        expect(typeof ciclo.pagado).toBe("boolean");
      }
    }
  });
});
