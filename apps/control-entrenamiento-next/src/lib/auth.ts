import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { verificarCredenciales, type UsuarioAuth } from "@/repositories/usuarios";

/**
 * Quién puede entrar en la aplicación.
 *
 * **Cuentas de verdad, una por persona**, guardadas en `auth.users` de
 * Supabase con su contraseña cifrada por la propia base de datos (bcrypt).
 * Se dan de alta con `npm run crear:usuario`, nunca desde una pantalla: no
 * hay registro público, y no debe haberlo.
 *
 * SOBRE `@supabase/ssr`
 *
 * Las credenciales se comprueban contra `auth.users` desde el servidor, y la
 * sesión es una cookie firmada por la aplicación. No se usa `@supabase/ssr`
 * todavía porque **falta la clave pública del proyecto** (`anon`), que solo
 * está en el panel de Supabase. En cuanto esté, se cambia la comprobación por
 * `signInWithPassword` sin tocar nada más: los usuarios ya son los correctos y
 * viven donde tienen que vivir, así que el cambio no mueve un solo dato.
 *
 * LA PUERTA DE EMERGENCIA
 *
 * Queda la contraseña única de antes, pero **apagada salvo que se encienda a
 * propósito** con `PERMITIR_CLAVE_UNICA=1`, y solo para entrar en un entorno
 * de pruebas sin crear cuentas. En producción no se enciende: una contraseña
 * compartida no identifica a nadie y no se puede revocar sin cambiársela a
 * todo el mundo.
 */

const COOKIE = "af_sesion";
const DURACION = 60 * 60 * 24 * 14; // dos semanas

function respaldoActivo(): boolean {
  return process.env.PERMITIR_CLAVE_UNICA === "1";
}

function secreto(): string {
  const valor = process.env.SESSION_SECRET;
  if (!valor) throw new Error("Falta SESSION_SECRET");
  return valor;
}

/** `<contenido en base64>.<firma>`, para que no se pueda inventar a mano. */
function firmar(contenido: string): string {
  return `${contenido}.${createHmac("sha256", secreto()).update(contenido).digest("hex")}`;
}

function abrirCookie(cookie: string): { correo: string; caduca: number } | null {
  const corte = cookie.lastIndexOf(".");
  if (corte < 0) return null;

  const contenido = cookie.slice(0, corte);
  const esperada = Buffer.from(firmar(contenido));
  const recibida = Buffer.from(cookie);
  // En tiempo constante: comparar con `===` filtra cuántos caracteres se han
  // acertado.
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;

  try {
    const datos = JSON.parse(Buffer.from(contenido, "base64url").toString("utf8"));
    if (typeof datos?.correo !== "string" || typeof datos?.caduca !== "number") return null;
    // La caducidad va DENTRO de la firma: alargarla obligaría a falsificarla.
    if (Date.now() > datos.caduca) return null;
    return datos;
  } catch {
    return null;
  }
}

async function abrirSesion(correo: string): Promise<void> {
  const contenido = Buffer.from(
    JSON.stringify({ correo, caduca: Date.now() + DURACION * 1000 }),
  ).toString("base64url");

  (await cookies()).set(COOKIE, firmar(contenido), {
    httpOnly: true, // ningún JavaScript la lee
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DURACION,
  });
}

// ---------------------------------------------------------------------------

export interface ResultadoAcceso {
  ok: boolean;
  mensaje?: string;
}

export async function entrar(correo: string, clave: string): Promise<ResultadoAcceso> {
  let usuario: UsuarioAuth | null;
  try {
    usuario = await verificarCredenciales(correo, clave);
  } catch {
    return { ok: false, mensaje: "No se puede comprobar el acceso ahora mismo. Inténtalo en un minuto." };
  }

  // Nunca se distingue «ese correo no existe» de «la contraseña no es esa»:
  // decirlo permitiría averiguar qué correos están dados de alta.
  if (!usuario) return { ok: false, mensaje: "Correo o contraseña incorrectos." };

  await abrirSesion(usuario.correo);
  return { ok: true };
}

/** Puerta de emergencia de pruebas. Apagada salvo que se encienda a propósito. */
export async function entrarConClaveUnica(clave: string): Promise<ResultadoAcceso> {
  if (!respaldoActivo()) return { ok: false, mensaje: "Esta forma de acceso está desactivada." };

  const esperada = Buffer.from(process.env.APP_PASSWORD ?? "");
  const dada = Buffer.from(clave ?? "");
  if (!esperada.length || esperada.length !== dada.length || !timingSafeEqual(esperada, dada)) {
    return { ok: false, mensaje: "Contraseña incorrecta." };
  }

  await abrirSesion("pruebas@local");
  return { ok: true };
}

export async function haySesion(): Promise<boolean> {
  return (await correoActual()) !== null;
}

/** Quién está dentro, o `null`. */
export async function correoActual(): Promise<string | null> {
  const cookie = (await cookies()).get(COOKIE)?.value;
  if (!cookie) return null;

  const datos = abrirCookie(cookie);
  if (!datos) return null;

  // La sesión de pruebas solo vale si esa puerta sigue encendida: apagarla
  // echa a quien hubiera entrado por ahí.
  if (datos.correo === "pruebas@local" && !respaldoActivo()) return null;

  return datos.correo;
}

export async function cerrarSesion(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export function claveUnicaDisponible(): boolean {
  return respaldoActivo();
}
