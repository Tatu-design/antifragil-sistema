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

/**
 * Lo que se abre sin cuenta.
 *
 *   `/login`   — la puerta, por definición.
 *   `/mi/`     — el enlace del cliente: lo que protege es su token.
 *   `/perfil/` — las fotos de los profesionales. **Es una imagen**, y esa
 *                misma foto se le enseña al cliente en su enlace, donde entra
 *                sin cuenta. Sin esto el filtro la redirigía al login y el
 *                navegador recibía una página HTML donde esperaba una foto:
 *                todos los avatares salían rotos (2026-08-12).
 */
const PUBLICAS = ["/login", "/mi/", "/perfil/"];

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

/**
 * Se excluye cualquier ruta con extensión de archivo.
 *
 * Sin esto, la propia hoja de estilos (`/style.css`), las fuentes y el logo se
 * redirigían al login por no llevar cookie, y la pantalla de entrada salía sin
 * un solo estilo. Son archivos públicos: no hay nada que proteger en ellos.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)"],
};
