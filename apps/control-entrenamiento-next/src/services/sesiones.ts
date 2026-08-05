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
import { anioDe, hoyNegocio, horaNegocio, mesDe, rangoSemana } from "@/lib/fechas";
import { repositorio } from "@/repositories";
import { comprobarYAvisar } from "./verificacion";

export interface OpcionesFirma {
  fecha?: string;
  /** Valor de un solo uso por carga de página. Impide que un reintento de red
   *  o dos pestañas guarden la misma petición dos veces. */
  claveIdempotencia?: string;
}

export async function firmarSesion(clienteId: string, opciones: OpcionesFirma = {}): Promise<ResultadoFirma> {
  const repo = repositorio();
  const fecha = opciones.fecha ?? hoyNegocio();

  const resultado = await repo.transaccion(async () => {
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
      // Esta sesión ha cerrado el ciclo. El que se cierra CONSERVA su propio
      // estado de cobro —pagado si lo estaba, pendiente si lo estaba— y el
      // siguiente nace pendiente con las mismas condiciones. Un servicio
      // nuevo NUNCA hereda el cobro del anterior (2026-08-05).
      await repo.guardarCiclo({ ...ciclo, fechaFin: fecha, pagado: ciclo.pagado });
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

    // Avisos, para que Fernando se entere sin tener que estar mirando la lista.
    if (renovado) {
      await repo.registrarAviso({
        fecha,
        tipo: "servicio_terminado",
        detalle: `«${cliente.nombre}» ha terminado su servicio y el nuevo queda pendiente de pago`,
      });
    } else if (avisoUltimaSesion) {
      await repo.registrarAviso({
        fecha,
        tipo: "ultima_sesion",
        detalle: `A «${cliente.nombre}» le queda 1 sesión: la próxima toca renovar`,
      });
    }

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

  // Ya está guardado: ahora se comprueba que la economía de esa semana sigue
  // cuadrando con lo firmado. Si no, deja un aviso — nunca corrige sola.
  await comprobarYAvisar(fecha);
  return resultado;
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
  let cuando = "";

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

    cuando = sesion.fecha;
    await repo.eliminarSesion(sesionId);
    await repo.sumarASemana(sesion.fecha, sesion.tarifa, -1);

    // Las sesiones posteriores del MISMO ciclo bajan un número: si se borra
    // la 3 de 7, las que eran 4..7 pasan a ser 3..6. El servicio ha
    // consumido 6 sesiones, no 7.
    //
    // Sin esto, el contador —que se calcula con el número de la última que
    // queda— se quedaba clavado en 7 aunque solo hubiera 6 sesiones, y la
    // ficha se contradecía con su propio historial (lo detectó Fernando con
    // Paquito en la versión Flask, 2026-08-04; el mismo fallo estaba
    // portado aquí).
    //
    // Se baja el número en vez de contar filas a secas para respetar a un
    // cliente que empezó a media, con sesiones hechas antes de entrar en la
    // app: sus números arrancan más arriba y siguen bajando de uno en uno.
    await repo.renumerarPosteriores(clienteId, sesion.ciclo, sesion.numeroSesion);

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

  if (cuando) await comprobarYAvisar(cuando);
}

/**
 * Corrige la fecha o el número de una sesión ya guardada.
 *
 * Si el cambio de fecha la mueve a otra semana, su dinero **y su hora** se
 * trasladan de una a la otra — con la tarifa HISTÓRICA de esa sesión, nunca la
 * actual del cliente.
 */
export async function editarSesion(
  clienteId: string,
  sesionId: string,
  nuevaFecha: string,
  nuevoNumero: number,
): Promise<void> {
  const repo = repositorio();
  let semanaAnterior = "";

  await repo.transaccion(async () => {
    const cliente = await repo.obtenerCliente(clienteId);
    if (!cliente) throw new ErrorDeNegocio("Ese cliente ya no existe");

    const sesiones = await repo.listarSesiones(clienteId);
    const sesion = sesiones.find((s) => s.id === sesionId);
    if (!sesion) throw new ErrorDeNegocio("Esa sesión ya no existe");
    semanaAnterior = sesion.fecha;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(nuevaFecha)) {
      throw new ErrorDeNegocio(`Fecha no válida: «${nuevaFecha}»`);
    }
    // `sesionesTotales = 0` significa SIN LÍMITE, no cero: con una mensualidad
    // o una cuenta no hay tope contra el que comparar.
    if (nuevoNumero < 1 || (sesion.sesionesTotales > 0 && nuevoNumero > sesion.sesionesTotales)) {
      const limite = sesion.sesionesTotales > 0 ? `1 y ${sesion.sesionesTotales}` : "1 en adelante";
      throw new ErrorDeNegocio(`El número de sesión debe estar entre ${limite}`);
    }

    // Igual que al borrar: no se toca una sesión de un servicio ya cerrado si
    // después hay sesiones de otros. Renumerarlo todo en silencio sería peor.
    const posteriores = sesiones.filter((s) => s.ciclo > sesion.ciclo).length;
    if (posteriores > 0) {
      throw new ErrorDeNegocio(
        `No se puede corregir la sesión ${sesion.numeroSesion}: pertenece a un servicio ya cerrado y ` +
          `después hay ${posteriores} sesiones que dependen de ella.`,
      );
    }

    const cambiaDeSemana = rangoSemana(sesion.fecha).inicio !== rangoSemana(nuevaFecha).inicio;
    if (cambiaDeSemana) {
      await repo.sumarASemana(sesion.fecha, sesion.tarifa, -1);
      await repo.sumarASemana(nuevaFecha, sesion.tarifa, 1);
    }

    await repo.guardarSesionEditada(sesionId, nuevaFecha, nuevoNumero);

    // El contador se recalcula desde lo que queda, no se toca a mano.
    const quedan = (await repo.listarSesiones(clienteId)).filter((s) => s.ciclo === cliente.cicloActual);
    await repo.actualizarCliente({
      ...cliente,
      sesionesCompletadas: quedan.length ? Math.max(...quedan.map((s) => s.numeroSesion)) : 0,
    });
  });

  // Las dos semanas: la que pierde la sesión y la que la recibe.
  if (semanaAnterior) await comprobarYAvisar(semanaAnterior);
  if (nuevaFecha !== semanaAnterior) await comprobarYAvisar(nuevaFecha);
}

/**
 * Borra un cliente entero, retirando también su facturación.
 *
 * Se hace **sesión a sesión**, de la más reciente a la más antigua, en vez de
 * un borrado directo: así su dinero no se queda contado para siempre en la
 * economía sin ninguna sesión detrás. Ese descuadre silencioso es justo lo que
 * el sistema Python se dedicó a eliminar.
 */
export async function eliminarClienteConHistorial(
  clienteId: string,
): Promise<{ sesionesBorradas: number; importeDescontado: number }> {
  const repo = repositorio();

  return repo.transaccion(async () => {
    const cliente = await repo.obtenerCliente(clienteId);
    if (!cliente) throw new ErrorDeNegocio("Ese cliente ya no existe");

    const sesiones = await repo.listarSesiones(clienteId);
    const importe = sesiones.reduce((suma, s) => suma + (s.tarifa ?? 0), 0);

    // De la más reciente a la más antigua, que es como ya vienen ordenadas.
    for (const sesion of sesiones) {
      await repo.eliminarSesion(sesion.id);
      await repo.sumarASemana(sesion.fecha, sesion.tarifa, -1);
    }

    await repo.eliminarCliente(clienteId);
    return { sesionesBorradas: sesiones.length, importeDescontado: Math.round(importe * 100) / 100 };
  });
}

export { puedeFirmarse, MENSUALIDAD };
