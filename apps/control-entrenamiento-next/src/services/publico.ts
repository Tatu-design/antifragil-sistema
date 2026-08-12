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
import { urlDeFoto } from "@/lib/foto-perfil";
import type { Ciclo, FichaServicio, Sesion } from "@/domain/tipos";
import { hoyNegocio, horaNegocio } from "@/lib/fechas";
import { repositorio } from "@/repositories";

/**
 * Una sesión, tal y como se le manda al cliente.
 *
 * Es un recorte a propósito. La sesión completa lleva `tarifa` y `servicio`,
 * y el nombre del servicio lleva el precio dentro («Antiguo 35€ x16»). Aunque
 * la pantalla no los pinte, **Next incrusta en la página los datos que recibe
 * el navegador**: quien mirara el código fuente le vería la tarifa (2026-08-10).
 *
 * No basta con no pintarlo. Hay que no enviarlo.
 */
export interface SesionPublica {
  id: string;
  numeroSesion: number;
  fecha: string;
  hora: string | null;
}

/**
 * Un programa contratado, tal y como se le enseña al cliente.
 *
 * **No lleva el nombre del programa, y es deliberado.** Los nombres son
 * etiquetas internas de Fernando y llevan la tarifa dentro: «Nuevo 45€ x4»,
 * «Pareja 60€ x16», «Antiguo 35€ x8». Enseñárselos al cliente es enseñarle su
 * precio (encontrado el 2026-08-10: le pasaba a 7 de 9 clientes).
 *
 * Un programa se identifica para el cliente por lo que sí le dice algo: cuándo
 * empezó, cuándo terminó y cuántas sesiones tuvo.
 */
export interface ProgramaPublico {
  ciclo: number;
  esActual: boolean;
  /** `null` en programas migrados sin fecha. No se inventa ninguna. */
  desde: string | null;
  hasta: string | null;
  sesiones: SesionPublica[];
}

export interface PerfilPublico {
  nombre: string;
  /**
   * Quién le entrena: solo su nombre y la DIRECCIÓN de su foto.
   *
   * NO va el correo ni el rol. Esta pantalla la abre cualquiera que tenga el
   * enlace, así que sale lo justo para que el cliente sepa con quién trata.
   *
   * `fotoUrl` y no la foto: incrustarla serían 18 KB dentro de la página cada
   * vez que el cliente la abre, y son muchos clientes abriéndola desde el
   * móvil (2026-08-12).
   */
  profesional: { nombre: string; fotoUrl: string | null } | null;
  ficha: FichaServicio;
  /**
   * Su historial, agrupado por programa: primero el que tiene en curso y
   * después los anteriores, del más reciente al más antiguo.
   */
  programas: ProgramaPublico[];
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

  // Las cuatro lecturas van a la vez, y las sesiones del ciclo se cuentan de
  // las que ya tenemos en vez de pedirlas aparte (2026-08-05). Antes eran
  // siete viajes de red encadenados para una pantalla que el cliente abre
  // desde el móvil, muchas veces con mala cobertura.
  const [ciclos, sesiones, pendientesHoy, confirmadasHoy, profesional] = await Promise.all([
    repo.listarCiclos(cliente.id),
    repo.listarSesiones(cliente.id),
    repo.sesionesSinConfirmarHoy(cliente.id, hoy),
    repo.confirmacionesDeHoy(cliente.id, hoy),
    // Va en la MISMA tanda: el cliente ya está leído, así que preguntarlo aquí
    // no añade ni un milisegundo de espera.
    repo.perfilPorId(cliente.profesionalId),
  ]);

  const ciclo = ciclos.find((c) => c.ciclo === cliente.cicloActual) ?? null;

  return {
    nombre: cliente.nombre,
    // La foto va por su DIRECCIÓN, no incrustada: son 18 KB que si no
    // viajarían dentro de la página cada vez que el cliente la abre.
    profesional: profesional
      ? { nombre: profesional.nombre, fotoUrl: urlDeFoto(profesional) }
      : null,
    ficha: fichaServicio({
      ciclo,
      sesionesDelCiclo: sesiones.filter((s) => s.ciclo === cliente.cicloActual).length,
      sesionesCompletadas: cliente.sesionesCompletadas,
      estado: cliente.estado,
      // El estado de cobro sale del ciclo, igual que en la ficha de Fernando.
      pendientePago: ciclo ? !ciclo.pagado : cliente.pendientePago,
    }),
    programas: agruparPorPrograma(ciclos, sesiones, cliente.cicloActual),
    pendientesHoy,
    confirmadasHoy,
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

/** Deja de una sesión solo lo que el cliente puede ver. */
function soloLoVisible(sesion: Sesion): SesionPublica {
  return {
    id: sesion.id,
    numeroSesion: sesion.numeroSesion,
    fecha: sesion.fecha,
    hora: sesion.hora,
  };
}

/**
 * Agrupa las sesiones por el programa al que pertenecen.
 *
 * El programa en curso va primero aunque no sea el más reciente por fecha: es
 * lo que el cliente viene a mirar. Los demás, del más nuevo al más viejo.
 *
 * Un programa sin ninguna sesión no se enseña: para el cliente no ha pasado
 * nada en él, y una tarjeta vacía solo genera la duda de qué falta ahí.
 */
function agruparPorPrograma(
  ciclos: Ciclo[],
  sesiones: Sesion[],
  cicloActual: number,
): ProgramaPublico[] {
  return ciclos
    .map((ciclo) => ({
      ciclo: ciclo.ciclo,
      esActual: ciclo.ciclo === cicloActual,
      desde: ciclo.fechaInicio,
      hasta: ciclo.fechaFin,
      sesiones: sesiones
        .filter((s) => s.ciclo === ciclo.ciclo)
        // De la más reciente a la más antigua, como se mira un historial.
        .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.numeroSesion - a.numeroSesion)
        // Recortadas ANTES de salir del servicio: así ningún componente puede
        // recibir por error lo que no debe llegar al navegador.
        .map(soloLoVisible),
    }))
    .filter((p) => p.esActual || p.sesiones.length > 0)
    .sort((a, b) => Number(b.esActual) - Number(a.esActual) || b.ciclo - a.ciclo);
}
