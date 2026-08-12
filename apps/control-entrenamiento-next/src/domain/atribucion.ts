import { BONO, type Modalidad } from "./modalidades";

/**
 * De quién es económicamente cada cosa.
 *
 * Las reglas están aquí, en un solo sitio, porque las usan tres capas: las
 * consultas de economía, la validación al dar de alta y las pruebas. Escritas
 * dos veces acabarían diciendo cosas distintas.
 */

/**
 * El día que empezaron a existir los profesionales.
 *
 * No es una fecha elegida a mano: es cuando se creó la columna
 * `clientes.entrenador_id` (migración `20260809100000_multi_entrenador.sql`) y
 * cuando se dio de alta el primer perfil de entrenador. Antes de ese día el
 * concepto no existía en el sistema, así que **toda la producción anterior es
 * del administrador**, sin importar de quién sea el cliente hoy.
 *
 * Es importante que sea así y no «según el responsable actual»: un cliente que
 * hoy lleve Rafa pudo entrenar durante meses cuando Rafa ni siquiera existía.
 * Ese pasado no es suyo.
 */
export const DESDE_QUE_HAY_PROFESIONALES = "2026-08-09";

/**
 * Qué modalidades puede llevar un profesional.
 *
 * Regla de negocio de Fernando (2026-08-11): **los entrenadores solo trabajan
 * con bonos**. Las mensualidades, las cuentas de cliente y CrossFit son
 * exclusivamente del administrador.
 *
 * No es una limitación técnica que haya que quitar algún día: es cómo funciona
 * el negocio. Si cambia, se cambia aquí.
 */
export function modalidadesPermitidas(esAdministrador: boolean): readonly Modalidad[] {
  return esAdministrador ? (["bono", "mensualidad", "cuenta"] as const) : ([BONO] as const);
}

export function puedeLlevarModalidad(esAdministrador: boolean, modalidad: Modalidad): boolean {
  return modalidadesPermitidas(esAdministrador).includes(modalidad);
}

/** El mensaje que se le enseña a quien lo intenta. Sin jerga. */
export function porQueNoPuede(modalidad: Modalidad): string {
  const como = modalidad === "mensualidad" ? "una mensualidad" : "una cuenta de cliente";
  return `Un entrenador solo puede llevar clientes con bono, no con ${como}. Si este cliente necesita esa modalidad, tiene que llevarlo el administrador.`;
}

/**
 * Qué economía se está mirando: la del negocio entera o la de uno.
 *
 * **Sin nadie elegido, TODOS** (Fernando, 2026-08-12). Al entrar, el
 * administrador tiene que ver primero el total real de su negocio. Antes se
 * abría en la suya y el trabajo de los demás no salía en ninguna pantalla: la
 * sesión de 80 € de un cliente de Rafa no estaba en ningún total que se pudiera
 * mirar, y ese es justo el dinero que descuadra el mes contra su Excel.
 *
 * Un identificador que no exista —inventado, escrito a mano, de un profesional
 * borrado— cae también en «todos». No devuelve error ni, mucho menos, la
 * economía de otro.
 *
 * `esAdministrador` decide si entran las cosas que no son de ningún cliente
 * (CrossFit, ajustes, Kids). En «todos» entran siempre: son producción del
 * negocio.
 */
export function alcanceEconomico(
  pedido: string | null | undefined,
  profesionales: ReadonlyArray<{ id: string; rol: "admin" | "entrenador" }>,
): { profesionalId: string | null; esAdministrador: boolean; adminId: string | null } {
  const adminId = profesionales.find((p) => p.rol === "admin")?.id ?? null;
  const elegido = profesionales.find((p) => p.id === pedido) ?? null;
  return {
    profesionalId: elegido?.id ?? null,
    esAdministrador: elegido ? elegido.rol === "admin" : true,
    adminId,
  };
}

/**
 * De quién es una sesión, con las tres reglas en orden.
 *
 *   1. Si guardó a su profesional al firmarse, es de ese. Siempre. Cambiar
 *      después el responsable del cliente no mueve nada hacia atrás.
 *   2. Si no lo guardó y es anterior al día en que existieron los
 *      profesionales, es del administrador.
 *   3. Si no lo guardó y es posterior, del responsable actual del cliente —el
 *      único dato que queda. Son las firmadas entre que existieron los
 *      profesionales y que se empezó a anotar quién era.
 *
 * NUNCA se mira quién firmó. `firmadaPor` dice quién pulsó el botón: si el
 * administrador firma una sesión de un cliente de Rafa, la producción es de
 * Rafa.
 */
export function duenioDeLaSesion({
  profesionalId,
  fecha,
  responsableActual,
  adminId,
}: {
  profesionalId?: string | null;
  fecha: string;
  responsableActual?: string | null;
  adminId?: string | null;
}): string | null {
  if (profesionalId) return profesionalId;
  if (fecha < DESDE_QUE_HAY_PROFESIONALES) return adminId ?? null;
  return responsableActual ?? null;
}
