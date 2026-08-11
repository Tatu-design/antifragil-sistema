import "server-only";

/**
 * La dirección pública de la aplicación: la que se le manda a un cliente.
 *
 * POR QUÉ NO SE SACA DE LA PETICIÓN (2026-08-11)
 *
 * Antes se construía con el `host` de la petición, «así el enlace es correcto
 * tanto en local como desplegado». Suena razonable y estuvo mal desde el
 * primer día: en Vercel la misma aplicación responde en varias direcciones a
 * la vez.
 *
 *   https://antifragil-sistema.vercel.app              ← la pública
 *   https://antifragil-sistema-f9q05cljg-tatu5…app     ← una por despliegue
 *
 * Las segundas están detrás de **Vercel Deployment Protection**: quien entra
 * sin cuenta de Vercel se topa con «Login – Vercel», que le pide un correo.
 *
 * Así que si Fernando abría la aplicación por una dirección de despliegue —y
 * es facilísimo, basta con entrar desde el panel de Vercel o que el móvil la
 * recuerde—, el botón «Copiar enlace del cliente» copiaba esa dirección. Le
 * pasó a una clienta: le pidió correo y contraseña, y eran las de Vercel, no
 * las nuestras.
 *
 * El enlace de un cliente no puede depender de por dónde ande el profesional.
 * Es una dirección fija del negocio, igual que el número de teléfono.
 *
 * **Esto NO relaja ninguna protección.** La de despliegue sigue puesta y las
 * direcciones de despliegue siguen protegidas — que es lo correcto: son
 * versiones intermedias que no debe ver nadie de fuera. Lo único que cambia es
 * que dejamos de fabricar enlaces sobre ellas.
 */

/** La de producción. Se puede cambiar sin tocar código el día que haya dominio propio. */
const POR_DEFECTO = "https://antifragil-sistema.vercel.app";

export function urlPublica(hostDeLaPeticion?: string | null): string {
  const configurada = process.env.URL_PUBLICA?.trim();
  if (configurada) return configurada.replace(/\/+$/, "");

  // En local se usa el host real, para poder probar el enlace desde el móvil
  // en la misma wifi. En producción NUNCA: ahí manda la dirección pública.
  if (process.env.NODE_ENV !== "production" && hostDeLaPeticion) {
    const protocolo = hostDeLaPeticion.startsWith("localhost") ? "http" : "https";
    return `${protocolo}://${hostDeLaPeticion}`;
  }

  return POR_DEFECTO;
}

/** El enlace personal de un cliente, listo para mandárselo. */
export function enlaceDelCliente(token: string, hostDeLaPeticion?: string | null): string {
  return `${urlPublica(hostDeLaPeticion)}/mi/${token}`;
}
