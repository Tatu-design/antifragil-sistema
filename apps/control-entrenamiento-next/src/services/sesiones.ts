/**
 * Firmar, corregir y borrar sesiones.
 *
 * Port de `registrar_asistencia.py`. Aquí vive la operación más delicada del
 * sistema: firmar no es una cosa, son cinco (descontar el bono, escribir el
 * historial, sumar a la semana, cerrar el ciclo si se agotó y abrir el
 * siguiente). O pasan las cinco o no pasa ninguna.
 *
 * Ningún componente de React llama a nada de esto directamente: lo hacen las
 * Server Actions.
 */

import { randomUUID } from "node:crypto";

import { ErrorDeNegocio, MENSUALIDAD, consumeSesiones, tarifaDeLaSesion } from "@/domain/modalidades";
import { datosQueFaltan, puedeFirmarse } from "@/domain/ficha";
import { procesarUnaSesion } from "@/domain/programas";
import type { Ciclo, ResultadoFirma, Sesion } from "@/domain/tipos";
import { anioDe, hoyNegocio, horaNegocio, mesDe } from "@/lib/fechas";
import { repositorio } from "@/repositories";

export interface OpcionesFirma {
  fecha?: string;
  /** Valor de un solo uso por carga de página. Impide que un reintento de red
   *  o dos pestañas guarden la misma petición dos veces. */
  claveIdempotencia?: string;
}

export async function firmarSesion(clienteId: string, opciones: OpcionesFirma = {}): Promise<ResultadoFirma> {
  const repo = repositorio();
  const fecha = opciones.fecha ?? hoyNegocio();

  return repo.transaccion(async () => {
    const cliente = await repo.obtenerCliente(clienteId);
    if (!cliente) throw new ErrorDeNegocio("Ese cliente ya no existe");

    const ciclo = await repo.cicloActual(clienteId);
    if (!ciclo) throw new ErrorDeNegocio(`«${cliente.nombre}» no tiene un servicio asignado`);

    // Las mismas tres condiciones que la interfaz, comprobadas también aquí:
    // esconder un botón no impide llamar a la acción, y esta operación
    // descuenta bono, escribe historial y mueve dinero.
    if (cliente.estado !== "activo") {
      throw new ErrorDeNegocio(
        `«${cliente.nombre}» está ${cliente.estado}. Reactívalo antes de firmarle una sesión.`,
      );
    }
    const faltan = datosQueFaltan(ciclo);
    if (faltan.length > 0) {
      throw new ErrorDeNegocio(`A «${cliente.nombre}» le falta ${faltan.join(" y ")} — revísalo en Editar programa`);
    }

    if (opciones.claveIdempotencia) {
      const esNueva = await repo.registrarIdempotencia(opciones.claveIdempotencia);
      if (!esNueva) {
        // Ya se guardó esta misma petición: no se repite nada.
        return {
          numeroSesion: cliente.sesionesCompletadas,
          sesionesTotales: ciclo.sesionesTotales,
          renovado: false,
          avisoUltimaSesion: false,
          duplicado: true,
          modalidad: ciclo.modalidad,
          anio: anioDe(fecha),
          mes: mesDe(fecha),
        } satisfies ResultadoFirma;
      }
    }

    const tarifa = tarifaDeLaSesion(ciclo.modalidad, ciclo.tarifa);
    let numeroSesion: number;
    let renovado = false;
    let avisoUltimaSesion = false;

    if (consumeSesiones(ciclo.modalidad)) {
      const { paso, numeroSesion: numero } = procesarUnaSesion({
        sesionesRestantes: ciclo.sesionesTotales - cliente.sesionesCompletadas,
        sesionesTotales: ciclo.sesionesTotales,
        pendientePago: cliente.pendientePago,
      });
      numeroSesion = numero;
      renovado = paso.renovado;
      avisoUltimaSesion = paso.avisoUltimaSesion;

      cliente.sesionesCompletadas = renovado
        ? ciclo.sesionesTotales - paso.sesionesRestantes
        : cliente.sesionesCompletadas + 1;
      cliente.pendientePago = paso.pendientePago;
    } else {
      // Mensualidad y cuenta: no hay saldo que gastar ni renovación que
      // disparar. La sesión es simplemente la siguiente de este periodo.
      numeroSesion = (await repo.contarSesionesDelCiclo(clienteId, ciclo.ciclo)) + 1;
      cliente.sesionesCompletadas += 1;
    }

    const sesion: Sesion = {
      // UUID de verdad: la base de datos real tiene esa columna tipada como
      // uuid y rechaza cualquier otra cosa. Encontrado al probar contra
      // Supabase — el repositorio de staging admitía cualquier texto.
      id: randomUUID(),
      clienteId,
      fecha,
      hora: horaNegocio(),
      numeroSesion,
      sesionesTotales: ciclo.sesionesTotales,
      tarifa,
      ciclo: ciclo.ciclo,
      servicio: ciclo.servicio,
    };
    await repo.guardarSesion(sesion);
    await repo.sumarASemana(fecha, tarifa, 1);

    if (!ciclo.fechaInicio) {
      ciclo.fechaInicio = fecha;
      await repo.guardarCiclo(ciclo);
    }

    if (renovado) {
      // Esta sesión ha cerrado el ciclo: se anota cuándo terminó y si quedó
      // cobrado (es el único momento en que se sabe), y se abre el siguiente
      // con las MISMAS condiciones, que nace pendiente de pago.
      await repo.guardarCiclo({ ...ciclo, fechaFin: fecha, pagado: !ciclo.pagado ? false : true });
      const siguiente: Ciclo = {
        ...ciclo,
        ciclo: ciclo.ciclo + 1,
        fechaInicio: null,
        fechaFin: null,
        pagado: false,
      };
      await repo.guardarCiclo(siguiente);
      cliente.cicloActual = siguiente.ciclo;
      cliente.pendientePago = true;
    }

    await repo.actualizarCliente(cliente);

    return {
      numeroSesion,
      sesionesTotales: ciclo.sesionesTotales,
      renovado,
      avisoUltimaSesion,
      duplicado: false,
      modalidad: ciclo.modalidad,
      anio: anioDe(fecha),
      mes: mesDe(fecha),
    } satisfies ResultadoFirma;
  });
}

/**
 * Borra una sesión y deshace su aportación económica, con la tarifa
 * HISTÓRICA de esa sesión — nunca la actual del cliente.
 *
 * Si la sesión borrada era la más reciente de su ciclo y lo completaba,
 * también se deshace la renovación: si no, el cliente se quedaría marcado
 * pendiente de pago por un ciclo que, según el historial que queda, nunca
 * llegó a completarse.
 */
export async function eliminarSesion(clienteId: string, sesionId: string): Promise<void> {
  const repo = repositorio();

  await repo.transaccion(async () => {
    const cliente = await repo.obtenerCliente(clienteId);
    if (!cliente) throw new ErrorDeNegocio("Ese cliente ya no existe");

    const sesiones = await repo.listarSesiones(clienteId);
    const sesion = sesiones.find((s) => s.id === sesionId);
    if (!sesion) throw new ErrorDeNegocio("Esa sesión ya no existe");

    // Igual que en el sistema actual: no se toca una sesión de un ciclo ya
    // cerrado si después hay sesiones de ciclos posteriores. Se bloquea con un
    // mensaje claro en vez de recalcular en silencio toda la historia.
    const posteriores = sesiones.filter((s) => s.ciclo > sesion.ciclo).length;
    if (posteriores > 0) {
      throw new ErrorDeNegocio(
        `No se puede borrar la sesión ${sesion.numeroSesion}: pertenece a un servicio ya cerrado y ` +
          `después hay ${posteriores} sesiones que dependen de ella. Corrige primero las del servicio actual.`,
      );
    }

    const delCiclo = sesiones.filter((s) => s.ciclo === sesion.ciclo);
    const eraLaMasReciente = delCiclo[0]?.id === sesion.id;
    const completabaElCiclo = sesion.numeroSesion === sesion.sesionesTotales && sesion.sesionesTotales > 0;

    await repo.eliminarSesion(sesionId);
    await repo.sumarASemana(sesion.fecha, sesion.tarifa, -1);

    if (eraLaMasReciente && completabaElCiclo && cliente.cicloActual === sesion.ciclo + 1) {
      // Se deshace la renovación que disparó esta sesión.
      cliente.cicloActual = sesion.ciclo;
      cliente.pendientePago = false;
    }

    // El contador se recalcula desde lo que queda, no restando a ciegas.
    const quedan = (await repo.listarSesiones(clienteId)).filter((s) => s.ciclo === cliente.cicloActual);
    cliente.sesionesCompletadas = quedan.length ? Math.max(...quedan.map((s) => s.numeroSesion)) : 0;

    await repo.actualizarCliente(cliente);
  });
}

export { puedeFirmarse, MENSUALIDAD };
