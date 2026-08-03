/**
 * Consultas y altas de clientes. Todo lo que las pantallas necesitan saber,
 * ya resuelto aquí para que ningún componente calcule nada.
 */

import { randomUUID } from "node:crypto";

import { fichaServicio } from "@/domain/ficha";
import { ErrorDeNegocio, MENSUALIDAD, validarCondiciones } from "@/domain/modalidades";
import type { Modalidad } from "@/domain/modalidades";
import type { Ciclo, Cliente, Estado, FichaServicio, Sesion } from "@/domain/tipos";
import { repositorio } from "@/repositories";

export interface ClienteEnLista extends Cliente {
  ficha: FichaServicio;
  /** Servicios YA CERRADOS que siguen sin cobrarse. Una deuda no desaparece
   *  porque el periodo termine. */
  ciclosPendientes: number;
  /** Debe algo: el servicio actual o alguno anterior. */
  debe: boolean;
}

async function componerFicha(cliente: Cliente): Promise<{ ficha: FichaServicio; ciclo: Ciclo | null }> {
  const repo = repositorio();
  const ciclo = await repo.cicloActual(cliente.id);
  const sesionesDelCiclo = ciclo ? await repo.contarSesionesDelCiclo(cliente.id, ciclo.ciclo) : 0;
  // En una mensualidad manda el cargo del mes (H-02): el repositorio ya lo ha
  // resuelto al devolver el ciclo, así que aquí no se decide otra vez.
  const pendiente = ciclo?.modalidad === MENSUALIDAD && ciclo.pagado !== null
    ? !ciclo.pagado
    : cliente.pendientePago;
  return {
    ciclo,
    ficha: fichaServicio({
      ciclo,
      sesionesDelCiclo,
      sesionesCompletadas: cliente.sesionesCompletadas,
      estado: cliente.estado,
      pendientePago: pendiente,
    }),
  };
}

export async function listarClientes(): Promise<ClienteEnLista[]> {
  const repo = repositorio();
  const clientes = await repo.listarClientes();

  return Promise.all(
    clientes.map(async (cliente) => {
      const { ficha } = await componerFicha(cliente);
      const ciclos = await repo.listarCiclos(cliente.id);
      // Solo los distintos del actual: el actual ya lo describe la ficha, así
      // que las dos fuentes no pueden contradecirse. `pagado === null` no
      // cuenta como deuda: significa «no se sabe».
      const ciclosPendientes = ciclos.filter(
        (c) => c.ciclo !== cliente.cicloActual && c.pagado === false,
      ).length;
      return { ...cliente, ficha, ciclosPendientes, debe: ficha.pendientePago || ciclosPendientes > 0 };
    }),
  );
}

export interface PerfilCliente {
  cliente: Cliente;
  ficha: FichaServicio;
  ciclo: Ciclo | null;
  /** Cada servicio contratado con SUS sesiones. Agrupado por ciclo, no por
   *  nombre: tres bonos iguales seguidos son tres bonos, no uno de 24. */
  servicios: Array<Ciclo & { sesiones: Sesion[]; esActual: boolean }>;
}

export async function obtenerPerfil(clienteId: string): Promise<PerfilCliente | null> {
  const repo = repositorio();
  const cliente = await repo.obtenerCliente(clienteId);
  if (!cliente) return null;

  const { ficha, ciclo } = await componerFicha(cliente);
  const ciclos = await repo.listarCiclos(clienteId);
  const sesiones = await repo.listarSesiones(clienteId);

  const servicios = ciclos.map((c) => ({
    ...c,
    sesiones: sesiones.filter((s) => s.ciclo === c.ciclo),
    esActual: c.ciclo === cliente.cicloActual,
  }));

  return { cliente, ficha, ciclo, servicios };
}

export interface DatosAlta {
  nombre: string;
  modalidad: Modalidad;
  servicio: string;
  sesionesTotales?: number | null;
  precioTotal?: number | null;
  cuotaMensual?: number | null;
  tarifa?: number | null;
  sesionesReferencia?: number | null;
}

export async function crearCliente(datos: DatosAlta): Promise<Cliente> {
  const repo = repositorio();
  const nombre = datos.nombre.trim();
  if (!nombre) throw new ErrorDeNegocio("El nombre del cliente no puede estar vacío");

  const condiciones = validarCondiciones(datos.modalidad, datos);
  const hoy = new Date();

  const cliente: Cliente = {
    id: randomUUID(),
    nombre,
    estado: "activo",
    // El token se genera una vez y no se regenera nunca: es el enlace que el
    // cliente guarda y el QR que ya lleva impreso.
    token: randomUUID().replace(/-/g, ""),
    pendientePago: false,
    sesionesCompletadas: 0,
    cicloActual: 1,
  };

  const ciclo: Ciclo = {
    clienteId: cliente.id,
    ciclo: 1,
    modalidad: condiciones.modalidad,
    servicio: datos.servicio.trim() || condiciones.modalidad,
    tarifa: condiciones.tarifa,
    sesionesTotales: condiciones.sesionesTotales ?? 0,
    precioTotal: condiciones.precioTotal,
    cuotaMensual: condiciones.cuotaMensual,
    sesionesReferencia: condiciones.sesionesReferencia,
    anio: condiciones.modalidad === "bono" ? null : hoy.getFullYear(),
    mes: condiciones.modalidad === "bono" ? null : hoy.getMonth() + 1,
    fechaInicio: null,
    fechaFin: null,
    pagado: condiciones.modalidad === MENSUALIDAD ? false : true,
  };

  await repo.transaccion(async () => {
    await repo.crearCliente(cliente, ciclo);
    if (condiciones.modalidad === MENSUALIDAD && condiciones.cuotaMensual) {
      // Su cuota del mes, que es lo que manda en el cobro de una mensualidad.
      await repo.guardarCargo({
        clienteId: cliente.id,
        anio: ciclo.anio!,
        mes: ciclo.mes!,
        concepto: "mensualidad",
        ciclo: 1,
        importe: condiciones.cuotaMensual,
        pagado: false,
      });
      cliente.pendientePago = true;
      await repo.actualizarCliente(cliente);
    }
  });

  return cliente;
}

export async function cambiarEstado(clienteId: string, estado: Estado): Promise<void> {
  const repo = repositorio();
  await repo.transaccion(async () => {
    const cliente = await repo.obtenerCliente(clienteId);
    if (!cliente) throw new ErrorDeNegocio("Ese cliente ya no existe");
    // El estado es independiente del pago: se puede estar pausado debiendo, o
    // cancelado y al día. La deuda no desaparece por dejar de entrenar.
    await repo.actualizarCliente({ ...cliente, estado });
  });
}

export async function renombrarCliente(clienteId: string, nombre: string): Promise<void> {
  const repo = repositorio();
  const limpio = nombre.trim();
  if (!limpio) throw new ErrorDeNegocio("El nombre del cliente no puede estar vacío");

  await repo.transaccion(async () => {
    const cliente = await repo.obtenerCliente(clienteId);
    if (!cliente) throw new ErrorDeNegocio("Ese cliente ya no existe");
    // El identificador es interno y estable: renombrar no toca ninguna
    // relación. En el sistema actual esto violaba una clave foránea y necesitó
    // un arreglo delicado — aquí, por diseño, no puede pasar.
    await repo.actualizarCliente({ ...cliente, nombre: limpio });
  });
}

/**
 * Cambia el estado de COBRO de un servicio, y nada más.
 *
 * Nunca toca sesiones, horas, historial ni facturación: cobrar más tarde no
 * hace que el trabajo se haya hecho más tarde.
 */
export async function marcarCobro(clienteId: string, ciclo: number, pagado: boolean): Promise<void> {
  const repo = repositorio();
  await repo.transaccion(async () => {
    const cliente = await repo.obtenerCliente(clienteId);
    if (!cliente) throw new ErrorDeNegocio("Ese cliente ya no existe");

    const ciclos = await repo.listarCiclos(clienteId);
    const objetivo = ciclos.find((c) => c.ciclo === ciclo);
    if (!objetivo) throw new ErrorDeNegocio("Ese servicio no existe");

    await repo.guardarCiclo({ ...objetivo, pagado });

    // En una mensualidad manda el cargo, así que hay que escribirlo también:
    // si no, los dos indicadores volverían a contradecirse (H-02).
    if (objetivo.modalidad === MENSUALIDAD && objetivo.anio !== null && objetivo.mes !== null) {
      const cargo = await repo.cargoDelMes(clienteId, objetivo.anio, objetivo.mes);
      if (cargo) await repo.guardarCargo({ ...cargo, pagado });
    }

    // La ficha del cliente habla del servicio EN CURSO: marcar uno antiguo no
    // la toca.
    if (ciclo === cliente.cicloActual) {
      await repo.actualizarCliente({ ...cliente, pendientePago: !pagado });
    }
  });
}
