import { NextResponse, type NextRequest } from "next/server";

/**
 * Puerta rápida: sin cookie de sesión, a la pantalla de entrada.
 *
 * Se hace aquí y no solo en cada página porque una página con `loading.tsx`
 * empieza a enviar su esqueleto antes de resolver la redirección, y el
 * navegador acaba haciendo un refresco de un segundo. Desde el middleware la
 * redirección es inmediata y con código 307, sin enviar nada de la pantalla
 * privada.
 *
 * **Esto NO es la autorización de verdad.** Aquí solo se mira si la cookie
 * existe; quien comprueba su firma es `haySesion()`, en el servidor, y toda
 * acción que escribe la vuelve a exigir. Una cookie inventada pasa este filtro
 * y se estrella contra el siguiente — que es el orden correcto: rápido primero,
 * riguroso después.
 */
//: `/mi/...` es el enlace personal del cliente: entra sin cuenta, y lo que
//: protege es su token, no una contraseña.
const PUBLICAS = ["/login", "/mi/"];

export function middleware(peticion: NextRequest) {
  const { pathname } = peticion.nextUrl;
  if (PUBLICAS.some((ruta) => pathname.startsWith(ruta))) return NextResponse.next();

  if (!peticion.cookies.get("af_sesion")) {
    const destino = peticion.nextUrl.clone();
    destino.pathname = "/login";
    return NextResponse.redirect(destino);
  }
  return NextResponse.next();
}

export const config = {
  // Todo salvo los archivos estáticos y el icono.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
