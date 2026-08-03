/**
 * De dónde salen los datos.
 *
 * Si hay base de datos configurada (`DATABASE_URL`), se usa la real. Si no, el
 * repositorio de staging con datos ficticios en archivo — así el proyecto se
 * puede abrir y probar sin credenciales.
 *
 * Ni las pantallas, ni los servicios, ni las reglas de negocio saben cuál de
 * los dos está detrás.
 */

import "server-only";

import { RepositorioPostgres } from "./postgres";
import { RepositorioStaging } from "./staging";
import type { Repositorio } from "./tipos";

let instancia: Repositorio | null = null;

export function repositorio(): Repositorio {
  if (!instancia) {
    instancia = process.env.DATABASE_URL ? new RepositorioPostgres() : new RepositorioStaging();
  }
  return instancia;
}

/** Qué está usando ahora mismo, para poder decirlo en pantalla. */
export function origenDeDatos(): "supabase" | "staging" {
  return process.env.DATABASE_URL ? "supabase" : "staging";
}

export type { Repositorio, SemanaEconomica } from "./tipos";
