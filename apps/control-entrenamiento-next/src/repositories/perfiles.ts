import "server-only";

import { cache } from "react";

import { repositorio } from "./index";
import type { Perfil } from "./tipos";

/**
 * Los profesionales que usan la aplicación.
 *
 * Es una capa fina sobre el repositorio: lo único que añade es `cache()`, que
 * resuelve cada pregunta UNA vez por petición aunque la hagan varios
 * componentes. Sin eso, la identidad costaría un viaje a la base por cada
 * bloque de la pantalla que quisiera saber quién eres.
 *
 * Va contra el repositorio y no contra SQL directo para que estas preguntas
 * —las de seguridad, las más importantes de todas— se puedan probar con el
 * repositorio de pruebas igual que el resto.
 *
 * Los CLIENTES no están aquí. Entran por su enlace personal, sin cuenta, y así
 * seguirá siendo.
 */

export type { Perfil };

/**
 * El perfil de quien ha iniciado sesión, buscado por su correo.
 *
 * Tener cuenta no basta: hace falta perfil. Así se le retira el acceso a
 * alguien sin tocar su cuenta de correo.
 */
export const perfilPorCorreo = cache(
  async (correo: string): Promise<Perfil | null> => repositorio().perfilPorCorreo(correo),
);

/**
 * De quién es ese cliente. `null` si no existe o si no tiene responsable.
 *
 * Devuelve lo mismo en los dos casos a propósito: quien pregunta por un
 * cliente que no es suyo no debe poder distinguir «no existe» de «existe pero
 * no es tuyo».
 */
export const profesionalDelCliente = cache(
  async (clienteId: string): Promise<string | null> => repositorio().profesionalDelCliente(clienteId),
);

/** Los profesionales, para el filtro de la lista. Solo lo usa el administrador. */
export const listarProfesionales = cache(
  async (): Promise<Perfil[]> => repositorio().listarProfesionales(),
);
