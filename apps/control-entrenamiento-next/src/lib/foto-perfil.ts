import { createHash } from "node:crypto";

import type { Perfil } from "@/repositories/tipos";

/**
 * Cómo se le pasa un profesional a la interfaz.
 *
 * **Sin la foto incrustada.** La foto pesa unos 18 KB, y cualquier cosa que se
 * le pase a un componente de navegador viaja entera dentro de la página. Con
 * tres profesionales en la lista eran 55 KB en cada carga, el 62 % del peso
 * (2026-08-12).
 *
 * En su lugar va la DIRECCIÓN de la foto, que ocupa cuarenta caracteres y la
 * descarga el navegador una sola vez.
 */
export interface PerfilVisible {
  id: string;
  nombre: string;
  rol: "admin" | "entrenador";
  /** `null` si no tiene foto: entonces se enseñan sus iniciales. */
  fotoUrl: string | null;
}

/**
 * La dirección de la foto, con la huella de su contenido.
 *
 * La huella permite guardarla en el navegador «para siempre»: si alguien se
 * cambia la foto, la dirección cambia sola y se baja la nueva.
 */
export function urlDeFoto(perfil: { id: string; foto?: string | null }): string | null {
  if (!perfil.foto) return null;
  const version = createHash("sha1").update(perfil.foto).digest("hex").slice(0, 8);
  return `/perfil/${perfil.id}/foto?v=${version}`;
}

/** Deja un perfil listo para la interfaz: sin foto incrustada, con su dirección. */
export function paraLaInterfaz(perfil: Perfil): PerfilVisible {
  return {
    id: perfil.id,
    nombre: perfil.nombre,
    rol: perfil.rol,
    fotoUrl: urlDeFoto(perfil),
  };
}
