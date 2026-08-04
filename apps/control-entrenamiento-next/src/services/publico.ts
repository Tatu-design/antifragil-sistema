/**
 * El enlace personal del cliente.
 *
 * Es el único sitio del sistema donde alguien entra **sin cuenta**, así que
 * conviene tener muy claro qué puede y qué no puede hacer.
 *
 * PUEDE: ver lo suyo y confirmar que la sesión que Fernando ya firmó es
 * correcta.
 *
 * NO PUEDE: crear una sesión. Nunca. Ese fue el primer diseño y se descartó
 * el mismo día en el sistema Python al ver el riesgo: si el cliente pudiera
 * firmar la suya y Fernando ya hubiera firmado la de ese día, un solo
 * entrenamiento se contaría dos veces. Confirmar no toca el bono, ni el
 * historial, ni la economía, así que es imposible que duplique nada.
 *
 * **El cliente sale siempre del token**, jamás de un campo del formulario.
 */

import { fichaServicio } from "@/domain/ficha";
import type { FichaServicio, Sesion } from "@/domain/tipos";
import { hoyNegocio, horaNegocio } from "@/lib/fechas";
import { repositorio } from "@/repositories";

export interface PerfilPublico {
  nombre: string;
  ficha: FichaServicio;
  /** Su historial entero, como en la página pública de Flask. */
  historial: Sesion[];
  /** Sesiones de hoy que aún puede confirmar. Vacío = nada que confirmar. */
  pendientesHoy: Sesion[];
  confirmadasHoy: Array<{ hora: string }>;
  /** La fecha de negocio de hoy, para el aviso de «confirmada el …». */
  hoy: string;
}

export async function obtenerPerfilPublico(token: string): Promise<PerfilPublico | null> {
  const repo = repositorio();
  const cliente = await repo.obtenerClientePorToken(token);
  if (!cliente) return null;

  const hoy = hoyNegocio();
  const ciclo = await repo.cicloActual(cliente.id);
  const sesionesDelCiclo = ciclo ? await repo.contarSesionesDelCiclo(cliente.id, ciclo.ciclo) : 0;
  const sesiones = await repo.listarSesiones(cliente.id);

  return {
    nombre: cliente.nombre,
    ficha: fichaServicio({
      ciclo,
      sesionesDelCiclo,
      sesionesCompletadas: cliente.sesionesCompletadas,
      estado: cliente.estado,
      pendientePago: cliente.pendientePago,
    }),
    historial: sesiones,
    pendientesHoy: await repo.sesionesSinConfirmarHoy(cliente.id, hoy),
    confirmadasHoy: await repo.confirmacionesDeHoy(cliente.id, hoy),
    hoy,
  };
}

export interface ResultadoConfirmacion {
  ok: boolean;
  yaEstaba: boolean;
  hora?: string;
  motivo?: string;
}

/**
 * Confirma la sesión de hoy pendiente más antigua.
 *
 * Es **seguro repetirlo**: el QR se abre solo con escanearlo y puede
 * escanearse dos veces sin querer. Si ya estaba confirmada, se dice y ya.
 */
export async function confirmarSesion(token: string): Promise<ResultadoConfirmacion> {
  const repo = repositorio();

  return repo.transaccion(async () => {
    const cliente = await repo.obtenerClientePorToken(token);
    if (!cliente) return { ok: false, yaEstaba: false, motivo: "Este enlace no es válido." };

    const hoy = hoyNegocio();
    const pendientes = await repo.sesionesSinConfirmarHoy(cliente.id, hoy);
    if (pendientes.length === 0) {
      return { ok: true, yaEstaba: true };
    }

    const hora = horaNegocio();
    await repo.confirmarSesion(cliente.id, pendientes[0]!.id, hoy, hora);
    return { ok: true, yaEstaba: false, hora };
  });
}
