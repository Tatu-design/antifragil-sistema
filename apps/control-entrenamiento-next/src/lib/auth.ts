/**
 * Acceso de desarrollo y staging.
 *
 * El sistema actual tiene UNA contraseña y ningún usuario: la usa Fernando
 * desde su móvil. Aquí se reproduce eso mismo, con una cookie firmada, hasta
 * que se conecte Supabase Auth — que introduce cuentas donde hoy no las hay y
 * merece su propio bloque de trabajo.
 *
 * La cookie va firmada con HMAC para que no se pueda falsificar escribiéndola
 * a mano en el navegador. Es `httpOnly`, así que ningún JavaScript la lee.
 */

import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "af_sesion";
const VALOR = "fernando";

function secreto(): string {
  return process.env.SESSION_SECRET ?? "desarrollo-local-no-usar-en-produccion";
}

function firmar(valor: string): string {
  return `${valor}.${createHmac("sha256", secreto()).update(valor).digest("hex")}`;
}

function firmaValida(cookie: string): boolean {
  const corte = cookie.lastIndexOf(".");
  if (corte < 0) return false;
  const esperada = Buffer.from(firmar(cookie.slice(0, corte)));
  const recibida = Buffer.from(cookie);
  // Comparación en tiempo constante: comparar con `===` filtra información
  // sobre cuántos caracteres se han acertado.
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

export function contrasenaCorrecta(recibida: string): boolean {
  const esperada = Buffer.from(process.env.APP_PASSWORD ?? "antifragil");
  const dada = Buffer.from(recibida ?? "");
  return esperada.length === dada.length && timingSafeEqual(esperada, dada);
}

export async function haySesion(): Promise<boolean> {
  const cookie = (await cookies()).get(COOKIE)?.value;
  return Boolean(cookie && firmaValida(cookie));
}

export async function abrirSesion(): Promise<void> {
  (await cookies()).set(COOKIE, firmar(VALOR), {
    httpOnly: true,
    sameSite: "lax",
    // En producción siempre por HTTPS. En local se permite http.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function cerrarSesion(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
