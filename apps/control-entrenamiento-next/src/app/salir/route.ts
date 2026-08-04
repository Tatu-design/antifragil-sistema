import { NextResponse, type NextRequest } from "next/server";

import { cerrarSesion } from "@/lib/auth";

/**
 * `/salir`, como el `/logout` de Flask: un enlace normal, no un formulario.
 *
 * PERO un GET que cierra la sesión es frágil de una forma que Flask no sufre:
 * cualquiera puede pedirlo sin que nadie lo haya pulsado. Next.js **precarga**
 * los enlaces que están a la vista, y el chip «Salir» sale en la cabecera de
 * todas las pantallas — así que abrir cualquier página cerraba la sesión sola
 * (encontrado por Fernando, 2026-08-04).
 *
 * Por eso aquí se distingue una visita de verdad de una precarga, y solo la
 * primera cierra la sesión. Los enlaces, además, son `<a>` normales: así el
 * navegador tampoco se adelanta.
 */
export async function GET(peticion: NextRequest) {
  const cabecera = (nombre: string) => peticion.headers.get(nombre) ?? "";
  const esPrecarga =
    cabecera("next-router-prefetch") !== "" ||
    cabecera("purpose") === "prefetch" ||
    cabecera("x-purpose") === "prefetch" ||
    cabecera("sec-purpose").includes("prefetch") ||
    // Una precarga del enrutador pide el contenido, no la página entera.
    cabecera("rsc") !== "";

  if (esPrecarga) return new NextResponse(null, { status: 204 });

  await cerrarSesion();
  return NextResponse.redirect(new URL("/login", peticion.url));
}
