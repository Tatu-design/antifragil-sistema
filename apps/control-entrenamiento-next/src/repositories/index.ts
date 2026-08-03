/**
 * De dónde salen los datos.
 *
 * Hoy: staging en archivo, con datos ficticios. Cuando existan credenciales de
 * Supabase, se sustituye aquí y **no hay que tocar nada más** — ni pantallas,
 * ni reglas de negocio, ni servicios.
 */

import "server-only";

import { RepositorioStaging } from "./staging";
import type { Repositorio } from "./tipos";

let instancia: Repositorio | null = null;

export function repositorio(): Repositorio {
  if (!instancia) {
    // Cuando haya Supabase:
    //   instancia = process.env.NEXT_PUBLIC_SUPABASE_URL
    //     ? new RepositorioSupabase()
    //     : new RepositorioStaging();
    instancia = new RepositorioStaging();
  }
  return instancia;
}

export type { Repositorio, SemanaEconomica } from "./tipos";
