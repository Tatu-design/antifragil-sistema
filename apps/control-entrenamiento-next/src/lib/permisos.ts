import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";

import { correoActual } from "./auth";
import { perfilPorCorreo, entrenadorDelCliente, type Perfil } from "@/repositories/perfiles";

/**
 * Quién está usando la aplicación y qué puede hacer.
 *
 * Dos roles, y no habrá más hasta que haga falta de verdad:
 *
 *   admin       → Fernando. Ve y gestiona todo.
 *   entrenador  → Rafa. Solo sus clientes, y solo lo necesario para entrenar.
 *
 * POR QUÉ EL ROL SE LEE DE LA BASE Y NO DE LA COOKIE
 *
 * Meterlo en la cookie sería gratis: va firmada, nadie puede inventárselo. El
 * problema es quitarlo. La cookie dura dos semanas, así que retirarle el
 * acceso a alguien —o bajarlo de admin a entrenador— no tendría efecto hasta
 * catorce días después, y no habría forma de forzarlo.
 *
 * Leyéndolo de la base, un cambio de rol vale desde la siguiente pantalla, y
 * borrar el perfil echa a esa persona al instante. Cuesta una consulta por
 * petición —unos 20 ms desde Vercel—, compartida por todos los componentes
 * gracias a `cache()`. Es un precio pequeño por poder cerrar una puerta
 * cuando haga falta.
 *
 * DÓNDE VIVE LA SEGURIDAD DE VERDAD
 *
 * Aquí, en el servidor. Las políticas de la base de datos existen y dicen lo
 * correcto, pero HOY NO SE APLICAN: la aplicación se conecta como el usuario
 * `postgres`, que se las salta por diseño (comprobado el 2026-08-09). Por eso
 * cada acción y cada pantalla pasan por estas funciones, y las consultas de
 * lista filtran por `entrenador_id` en el propio SQL.
 *
 * Esconder un botón no es seguridad: es cortesía. Lo que impide entrar es esto.
 */

export type { Perfil };

/**
 * El usuario de esta petición, o `null` si no hay sesión válida.
 *
 * `cache()` lo resuelve una sola vez por petición aunque lo pregunten diez
 * componentes distintos.
 */
export const usuarioActual = cache(async (): Promise<Perfil | null> => {
  const correo = await correoActual();
  if (!correo) return null;
  return perfilPorCorreo(correo);
});

export function esAdmin(usuario: Perfil | null): boolean {
  return usuario?.rol === "admin";
}

/**
 * Exige haber iniciado sesión. Devuelve quién es.
 *
 * Si la cuenta existe en la cookie pero ya no tiene perfil —porque se le ha
 * retirado el acceso— también manda al login: la cookie sola no vale.
 */
export async function exigirUsuario(): Promise<Perfil> {
  const usuario = await usuarioActual();
  if (!usuario) redirect("/login");
  return usuario;
}

/**
 * Exige ser administrador. Economía, avisos, alta y baja de clientes.
 *
 * Responde «no existe» en vez de «no puedes». Es a propósito: un «no puedes»
 * confirma que la pantalla existe y qué hay detrás. `forbidden()` de Next
 * exigiría encender una función experimental, y tampoco haría falta.
 */
export async function exigirAdmin(): Promise<Perfil> {
  const usuario = await exigirUsuario();
  if (!esAdmin(usuario)) notFound();
  return usuario;
}

/**
 * Exige poder tocar ESE cliente. Es el candado importante.
 *
 * Un administrador pasa siempre. Un entrenador solo si el cliente es suyo —da
 * igual que haya escrito la dirección a mano, que la haya adivinado o que se
 * la haya pasado alguien.
 *
 * Un cliente sin responsable asignado es del administrador y de nadie más: no
 * se le regala a quien pregunte primero.
 */
export async function exigirAccesoACliente(clienteId: string): Promise<Perfil> {
  const usuario = await exigirUsuario();
  if (esAdmin(usuario)) return usuario;

  const responsable = await entrenadorDelCliente(clienteId);
  // «No existe», no «no puedes»: así ni siquiera se confirma que ese cliente
  // esté dado de alta.
  if (responsable === null || responsable !== usuario.id) notFound();
  return usuario;
}

/**
 * Igual que la anterior, pero para las pantallas de solo lectura.
 *
 * Se separa por claridad, no por comportamiento: hoy leer y escribir exigen lo
 * mismo. Tenerlas con nombres distintos hace evidente en cada llamada qué se
 * está protegiendo.
 */
export const exigirLecturaDeCliente = exigirAccesoACliente;
