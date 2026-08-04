import { NextResponse, type NextRequest } from "next/server";

import { cerrarSesion } from "@/lib/auth";

/** `/salir`, como el `/logout` de Flask: un enlace normal, no un formulario. */
export async function GET(peticion: NextRequest) {
  await cerrarSesion();
  return NextResponse.redirect(new URL("/login", peticion.url));
}
