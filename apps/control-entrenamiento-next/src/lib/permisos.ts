import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

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
 * LA regla de acceso, sin nada alrededor.
 *
 * Se separa de `exigirAccesoACliente` para poder probarla a conciencia: la
 * otra habla con cookies y con la base, esta es aritmética pura y se le pueden
 * pasar los casos raros de uno en uno.
 *
 * `responsable` es de quién es el cliente, o `null` si no existe o si nadie lo
 * lleva todavía.
 */
export function puedeVerCliente(usuario: Perfil | null, responsable: string | null): boolean {
  if (!usuario) return false;
  if (esAdmin(usuario)) return true;
  // Un cliente sin responsable NO es de quien pregunte primero: es del
  // administrador hasta que se le asigne a alguien a propósito.
  if (responsable === null) return false;
  return responsable === usuario.id;
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
 * A quien no lo sea se le devuelve a su lista, sin explicaciones: no se le
 * dice «no puedes», que confirmaría qué hay detrás.
 *
 * POR QUÉ REDIRIGIR Y NO `notFound()` (2026-08-09)
 *
 * `notFound()` era lo primero que se probó y **escondía el contenido bien,
 * pero devolvía un 200**: estas pantallas son dinámicas, Next ya ha empezado a
 * enviar la respuesta cuando salta, y entonces ya no puede cambiar el código
 * de estado. Un 200 en una pantalla denegada es una trampa: cualquier prueba
 * automática que mire el estado daría por bueno un agujero.
 *
 * Una redirección se resuelve antes de empezar a enviar nada, así que da un
 * 307 inequívoco, se puede comprobar, y de paso deja a la persona en una
 * pantalla que sí puede usar.
 */
export async function exigirAdmin(): Promise<Perfil> {
  const usuario = await exigirUsuario();
  if (!esAdmin(usuario)) redirect("/clientes");
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
  // A su lista, sin decir nada. Un cliente ajeno y uno inventado se comportan
  // exactamente igual: no se puede averiguar quién está dado de alta probando
  // direcciones.
  if (!puedeVerCliente(usuario, responsable)) redirect("/clientes");
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
