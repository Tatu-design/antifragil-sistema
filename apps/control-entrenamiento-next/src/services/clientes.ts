/**
 * Consultas y altas de clientes. Todo lo que las pantallas necesitan saber,
 * ya resuelto aquí para que ningún componente calcule nada.
 */

import { randomUUID } from "node:crypto";

import { fichaServicio } from "@/domain/ficha";
import { ErrorDeNegocio, MENSUALIDAD, validarCondiciones } from "@/domain/modalidades";
import type { Modalidad } from "@/domain/modalidades";
import type { Ciclo, Cliente, Estado, FichaServicio, Sesion } from "@/domain/tipos";
import { hoyNegocio } from "@/lib/fechas";
import { repositorio } from "@/repositories";

export interface ClienteEnLista extends Cliente {
  ficha: FichaServicio;
  /** Servicios YA CERRADOS que siguen sin cobrarse. Una deuda no desaparece
   *  porque el periodo termine. */
  ciclosPendientes: number;
  /** Debe algo: el servicio actual o alguno anterior. */
  debe: boolean;
}

// `componerFicha` desapareció el 2026-08-05: hacía una consulta por cliente
// para su ciclo y otra para contar sus sesiones. Ahora la lista y el perfil
// componen la ficha con datos que ya tienen en memoria.

export async function listarClientes(): Promise<ClienteEnLista[]> {
  const repo = repositorio();
  // Dos lecturas en total, no cinco por cliente (2026-08-05). Contra Supabase
  // cada consulta es un viaje de red de ~180 ms: ir cliente a cliente hacía
  // que la pantalla más usada tardara varios segundos en abrirse.
  const [clientes, datos] = await Promise.all([repo.listarClientes(), repo.cargarTodoParaLaLista()]);

  const ciclosPorCliente = new Map<string, Ciclo[]>();
  for (const ciclo of datos.ciclos) {
    const lista = ciclosPorCliente.get(ciclo.clienteId) ?? [];
    lista.push(ciclo);
    ciclosPorCliente.set(ciclo.clienteId, lista);
  }

  return Promise.all(
    clientes.map(async (cliente) => {
      const ciclos = ciclosPorCliente.get(cliente.id) ?? [];
      const enCurso = ciclos.find((c) => c.ciclo === cliente.cicloActual) ?? null;
      const ficha = fichaServicio({
        ciclo: enCurso,
        sesionesDelCiclo: datos.sesionesPorCiclo.get(`${cliente.id}:${cliente.cicloActual}`) ?? 0,
        sesionesCompletadas: cliente.sesionesCompletadas,
        estado: cliente.estado,
        pendientePago: enCurso ? !enCurso.pagado : cliente.pendientePago,
      });
      // Solo los distintos del actual: el actual ya lo describe la ficha, así
      // que las dos fuentes no pueden contradecirse.
      //
      // NO se filtra por estado del cliente a propósito: un pausado o un
      // cancelado que deba dinero tiene que salir como pendiente de pago. La
      // deuda no se borra por dejar de entrenar.
      const ciclosPendientes = ciclos.filter(
        (c) => c.ciclo !== cliente.cicloActual && !c.pagado,
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

  // Los ciclos y las sesiones se piden A LA VEZ, y el ciclo en curso sale de
  // los que ya tenemos en vez de en otra consulta (2026-08-05). Antes eran
  // seis viajes de red encadenados; ahora son tres, y dos van en paralelo.
  const [ciclos, sesiones] = await Promise.all([
    repo.listarCiclos(clienteId),
    repo.listarSesiones(clienteId),
  ]);

  const ciclo = ciclos.find((c) => c.ciclo === cliente.cicloActual) ?? null;
  const ficha = fichaServicio({
    ciclo,
    sesionesDelCiclo: sesiones.filter((s) => s.ciclo === cliente.cicloActual).length,
    sesionesCompletadas: cliente.sesionesCompletadas,
    estado: cliente.estado,
    pendientePago: ciclo ? !ciclo.pagado : cliente.pendientePago,
  });

  const servicios = ciclos.map((c) => ({
    ...c,
    sesiones: sesiones.filter((s) => s.ciclo === c.ciclo),
    esActual: c.ciclo === cliente.cicloActual,
  }));

  return { cliente, ficha, ciclo, servicios };
}

/**
 * Cómo va la confirmación del cliente HOY, para el bloque del QR.
 *
 * Se consulta aparte y solo cuando la pantalla lo necesita: en Flask el QR
 * únicamente se pregunta justo después de firmar, que es una consulta menos en
 * cada visita.
 */
export async function confirmacionDeHoy(
  clienteId: string,
): Promise<{ hayPendiente: boolean; confirmadas: Array<{ hora: string }> }> {
  const repo = repositorio();
  const hoy = hoyNegocio();
  return {
    hayPendiente: (await repo.sesionesSinConfirmarHoy(clienteId, hoy)).length > 0,
    confirmadas: await repo.confirmacionesDeHoy(clienteId, hoy),
  };
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
    // Nace debiendo: nadie ha confirmado todavía que haya pagado.
    pendientePago: true,
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
    // Todo servicio nuevo nace PENDIENTE DE PAGO (2026-08-05), sea bono,
    // mensualidad o cuenta. Dar por cobrado lo que nadie ha confirmado era
    // inventar un ingreso.
    pagado: false,
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
    }
  });

  return cliente;
}

export interface CambioDeServicio {
  modalidad: Modalidad;
  servicio: string;
  sesionesTotales?: number | null;
  precioTotal?: number | null;
  cuotaMensual?: number | null;
  tarifa?: number | null;
  sesionesReferencia?: number | null;
}

export interface ResultadoCambio {
  cerroCiclo: boolean;
  ciclo: number;
}

/**
 * Configura el servicio de un cliente. Dos comportamientos muy distintos:
 *
 * **Si la modalidad NO cambia**, se corrigen las condiciones del ciclo en curso
 * ahí mismo. Es una corrección, no un servicio nuevo.
 *
 * **Si la modalidad SÍ cambia**, el ciclo actual se CIERRA y se abre uno nuevo.
 * Nunca se transforma un ciclo empezado: las sesiones ya hechas se quedan donde
 * están, con las condiciones con las que se hicieron, y su economía no se
 * recalcula. Un bono a medias no se convierte en una mensualidad — se cierra
 * como bono y empieza una mensualidad limpia.
 *
 * En los dos casos, las sesiones ya firmadas conservan su tarifa histórica:
 * cambiar el precio hoy no reescribe lo que se cobró ayer.
 */
export async function configurarServicio(
  clienteId: string,
  cambio: CambioDeServicio,
): Promise<ResultadoCambio> {
  const repo = repositorio();
  const condiciones = validarCondiciones(cambio.modalidad, cambio);
  const hoy = new Date();

  return repo.transaccion(async () => {
    const cliente = await repo.obtenerCliente(clienteId);
    if (!cliente) throw new ErrorDeNegocio("Ese cliente ya no existe");

    const actual = await repo.cicloActual(clienteId);
    if (!actual) throw new ErrorDeNegocio("Ese cliente no tiene servicio en curso");

    const etiqueta = cambio.servicio.trim() || ETIQUETAS_SERVICIO[condiciones.modalidad];
    const esMensualNueva = condiciones.modalidad !== "bono";
    const anio = esMensualNueva ? hoy.getFullYear() : null;
    const mes = esMensualNueva ? hoy.getMonth() + 1 : null;

    const camposEconomicos = {
      servicio: etiqueta,
      modalidad: condiciones.modalidad,
      tarifa: condiciones.tarifa,
      sesionesTotales: condiciones.sesionesTotales ?? 0,
      precioTotal: condiciones.precioTotal,
      cuotaMensual: condiciones.cuotaMensual,
      sesionesReferencia: condiciones.sesionesReferencia,
    };

    if (actual.modalidad === condiciones.modalidad) {
      // Misma modalidad: se corrigen las condiciones del ciclo en curso.
      await repo.guardarCiclo({ ...actual, ...camposEconomicos });
      await cobrarMesSiProcede(clienteId, actual.ciclo, actual.anio, actual.mes, condiciones.cuotaMensual);
      return { cerroCiclo: false, ciclo: actual.ciclo };
    }

    // Cambia la modalidad: se cierra el ciclo y se abre otro.
    const sesiones = await repo.listarSesiones(clienteId);
    const ultima = sesiones.filter((s) => s.ciclo === actual.ciclo)[0]?.fecha ?? null;
    await repo.guardarCiclo({
      ...actual,
      fechaFin: actual.fechaFin ?? ultima ?? hoy.toISOString().slice(0, 10),
    });

    const nuevo = actual.ciclo + 1;
    await repo.guardarCiclo({
      clienteId,
      ciclo: nuevo,
      ...camposEconomicos,
      anio,
      mes,
      fechaInicio: null,
      fechaFin: null,
      // TODO servicio nuevo nace PENDIENTE DE PAGO, sea de la modalidad que
      // sea (2026-08-05). Antes solo la mensualidad nacía pendiente y el
      // resto se daba por cobrado de salida: eso inventaba un cobro que
      // nadie había confirmado. Solo pasa a pagado con una acción explícita
      // de Fernando.
      pagado: false,
    });

    // El contador vuelve a cero: el servicio nuevo empieza limpio. Las sesiones
    // anteriores NO se mueven ni se renumeran.
    await repo.actualizarCliente({
      ...cliente,
      cicloActual: nuevo,
      sesionesCompletadas: 0,
      // Espejo del ciclo nuevo, que nace pendiente.
      pendientePago: true,
    });
    await cobrarMesSiProcede(clienteId, nuevo, anio, mes, condiciones.cuotaMensual);

    return { cerroCiclo: true, ciclo: nuevo };
  });
}

const ETIQUETAS_SERVICIO: Record<Modalidad, string> = {
  bono: "Bono",
  mensualidad: "Mensualidad",
  cuenta: "Cuenta de cliente",
};

/**
 * Registra la cuota del mes de una mensualidad — una sola vez.
 *
 * Solo las mensualidades generan cargo: una cuenta de cliente factura por las
 * sesiones que se firmen, no por adelantado. Y un cliente pausado o cancelado
 * no genera cuota: cobrar automáticamente a quien ha dejado de entrenar sería
 * inventar ingresos.
 */
async function cobrarMesSiProcede(
  clienteId: string,
  ciclo: number,
  anio: number | null,
  mes: number | null,
  cuota: number | null,
): Promise<void> {
  if (!cuota || anio === null || mes === null) return;
  const repo = repositorio();
  const cliente = await repo.obtenerCliente(clienteId);
  if (!cliente || cliente.estado !== "activo") return;

  const existente = await repo.cargoDelMes(clienteId, anio, mes);
  if (existente) return; // La clave (cliente, año, mes) impide cobrar dos veces.

  await repo.guardarCargo({
    clienteId,
    anio,
    mes,
    concepto: "mensualidad",
    ciclo,
    importe: cuota,
    pagado: false,
  });
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
