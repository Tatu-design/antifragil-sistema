import { NextResponse } from "next/server";

import { repositorio } from "@/repositories";

/**
 * La ficha de instalación DEL CLIENTE. Una por enlace.
 *
 * POR QUÉ EXISTE (2026-08-14)
 *
 * Tres clientes añadieron su enlace a la pantalla de inicio del iPhone y, al
 * abrir el icono, les salía nuestra pantalla de correo y contraseña.
 *
 * No era su enlace: era el manifiesto. La aplicación declara uno global para
 * que el panel interno se comporte como una app de verdad, y ahí dentro pone
 * `start_url: "/clientes"` — que es justo por donde Fernando quiere empezar a
 * trabajar. La pantalla del cliente heredaba ese mismo manifiesto, así que al
 * instalarla el iPhone no guardaba la dirección que el cliente tenía abierta,
 * sino la del panel. Al abrir el icono arrancaba en `/clientes`, que no es
 * pública, y acababa en el login.
 *
 * Con este manifiesto, cada enlace instala **su** dirección:
 *
 *   `start_url` → `/mi/<su token>`
 *   `scope`     → lo suyo y lo que cuelga de ello (su pantalla de confirmar)
 *   `id`        → identidad estable, para que dos clientes en el mismo móvil
 *                 sean dos aplicaciones distintas y no se pisen
 *
 * NO LLEVA EL NOMBRE DEL CLIENTE. El icono pone «Antifrágil» y nada más: un
 * manifiesto se puede pedir sin abrir la página, y no hay ninguna razón para
 * que diga a quién pertenece. El token sigue siendo la única llave.
 *
 * Si el token no existe, 404. No se devuelve un manifiesto por defecto: eso
 * crearía un icono que al abrirse llevaría a cualquier otro sitio.
 *
 * SOBRE LOS IPHONE QUE NO LEEN MANIFIESTOS (iOS anterior a 16.4): guardan la
 * dirección que está abierta, que es la correcta. Esos nunca tuvieron el
 * problema y esto no les cambia nada.
 */
export const dynamic = "force-dynamic";

export async function GET(_peticion: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Una sola consulta, la más barata que hay: solo hace falta saber que el
  // enlace es de alguien. No se lee el perfil ni el historial.
  const cliente = await repositorio().obtenerClientePorToken(token);
  if (!cliente) return new NextResponse(null, { status: 404 });

  // El token viaja en una dirección, así que se codifica como tal. Hoy son 32
  // caracteres de la A a la F y números —no hay nada que escapar—, pero el día
  // que cambien de forma esto sigue siendo correcto sin que nadie se acuerde.
  const suyo = `/mi/${encodeURIComponent(token)}`;

  return NextResponse.json(
    {
      // Lo que se lee debajo del icono. Deliberadamente igual para todos.
      name: "Antifrágil",
      short_name: "Antifrágil",
      id: suyo,
      start_url: suyo,
      scope: suyo,
      display: "standalone",
      orientation: "portrait",
      lang: "es",
      theme_color: "#1fa99a",
      background_color: "#f5f7f4",
      icons: [
        { src: "/favicon.png", sizes: "180x180", type: "image/png", purpose: "any" },
        { src: "/favicon.png", sizes: "180x180", type: "image/png", purpose: "maskable" },
      ],
    },
    {
      headers: {
        "Content-Type": "application/manifest+json; charset=utf-8",
        // Que no se guarde: si un cliente reinstala su icono, tiene que pedirlo
        // otra vez. Y nunca en una caché compartida — cada uno es distinto.
        "Cache-Control": "private, no-store",
      },
    },
  );
}
