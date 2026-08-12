import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { repositorio } from "@/repositories";

/**
 * La foto de un profesional, servida como imagen de verdad.
 *
 * POR QUÉ EXISTE (2026-08-12)
 *
 * La foto se guarda en la base como data URI, y eso está bien. El problema era
 * enseñarla **incrustada dentro del HTML**: 18 KB que viajaban dos o tres
 * veces en CADA pantalla —una en la página y otra en los datos que Next manda
 * al navegador— y que se volvían a descargar enteros en cada visita. Eran el
 * 62 % del peso de la lista de clientes.
 *
 * Sirviéndola aquí, el navegador la descarga UNA vez y la guarda. La segunda
 * pantalla ya no la pide.
 *
 * SOBRE LA CACHÉ
 *
 * La dirección lleva la huella de la propia foto (`?v=`), así que se puede
 * guardar «para siempre» sin miedo: si alguien se cambia la foto, la dirección
 * cambia y el navegador se baja la nueva. No hay que acordarse de vaciar nada.
 *
 * SOBRE EL ACCESO
 *
 * No pide sesión, y es correcto: esta misma foto se le enseña al cliente en su
 * enlace personal, donde entra sin cuenta. Es la foto de perfil de un
 * profesional, no un dato privado. No revela nada más: solo devuelve la
 * imagen.
 */
export async function GET(_peticion: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const perfil = await repositorio().perfilPorId(id);
  if (!perfil?.foto) return new NextResponse(null, { status: 404 });

  // La foto viene como `data:image/jpeg;base64,XXXX`.
  const coma = perfil.foto.indexOf(",");
  const cabecera = perfil.foto.slice(0, coma);
  const tipo = /^data:([^;]+)/.exec(cabecera)?.[1] ?? "image/jpeg";
  const bytes = Buffer.from(perfil.foto.slice(coma + 1), "base64");

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": tipo,
      "Content-Length": String(bytes.length),
      // Un año, porque la dirección cambia cuando cambia la foto.
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${createHash("sha1").update(bytes).digest("hex").slice(0, 16)}"`,
    },
  });
}
