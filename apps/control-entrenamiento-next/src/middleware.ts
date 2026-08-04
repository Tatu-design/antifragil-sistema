import { NextResponse, type NextRequest } from "next/server";

/**
 * La puerta rápida: sin cookie de sesión, a la pantalla de entrada.
 *
 * Aquí solo se mira si la cookie EXISTE. Quien comprueba su firma y su
 * caducidad es `haySesion()`, en el servidor, y cada acción que escribe lo
 * vuelve a exigir por su cuenta. Una cookie inventada pasa este filtro y se
 * estrella contra el siguiente — que es el orden correcto: rápido primero,
 * riguroso después.
 *
 * Se hace aquí y no solo en cada pantalla porque una página con estado de
 * carga empieza a enviar su esqueleto antes de resolver la redirección, y el
 * navegador acabaría haciendo un refresco de un segundo.
 */

/** `/mi/...` es el enlace del cliente: entra sin cuenta y lo que protege es
 *  su token. `/login` tiene que ser accesible por definición. */
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
